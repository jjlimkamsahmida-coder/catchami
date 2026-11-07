use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId};

fn a(s: &str) -> AccountId { s.parse().unwrap() }
const ONE: u128 = 1_000_000_000_000_000_000;

fn ctx(pred: &str, ts_ns: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(a("game.near")).predecessor_account_id(a(pred)).block_timestamp(ts_ns).attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(b.build());
}

fn setup() -> Contract {
    ctx("owner.near", 1);
    Contract::new(a("owner.near"), a("operator.near"), a("token.near"), a("team.near"), U128(1_000 * ONE))
}

fn deposit(c: &mut Contract, from: &str, amount: u128, msg: &str) -> u128 {
    ctx("token.near", 1);
    match c.ft_on_transfer(a(from), U128(amount), msg.to_string()) {
        PromiseOrValue::Value(v) => v.0,
        _ => panic!("expected value"),
    }
}

fn mint(c: &mut Contract, id: &str, owner: &str) {
    ctx("operator.near", 1);
    c.mint(id.to_string(), a(owner), TokenMetadata { title: Some("Mochi".into()), description: None, media: None, media_hash: None, copies: None, issued_at: None, expires_at: None, starts_at: None, updated_at: None, extra: None, reference: None, reference_hash: None });
}

fn d(bucket: Bucket, amount: i128) -> Delta { Delta { bucket, amount: I128(amount) } }
const H: &str = "0000000000000000000000000000000000000000000000000000000000000000";

#[test]
fn deposits_credit_buckets_and_are_logged() {
    let mut c = setup();
    mint(&mut c, "a-1", "alice.near");
    assert_eq!(deposit(&mut c, "alice.near", 100 * ONE, "\"deposit_user\""), 0);
    assert_eq!(deposit(&mut c, "alice.near", 50 * ONE, r#"{"deposit_pet":{"token_id":"a-1"}}"#), 0);
    assert_eq!(deposit(&mut c, "hq-alloc.near", 500 * ONE, "\"deposit_hq\""), 0);
    assert_eq!(c.balance_of(Bucket::User(a("alice.near"))).balance.0, 100 * ONE);
    assert_eq!(c.balance_of(Bucket::Pet("a-1".into())).balance.0, 50 * ONE);
    assert_eq!(c.total_liabilities().0, 650 * ONE);
    let log = c.deposits_since(0, 10);
    assert_eq!(log.len(), 3);
    assert_eq!(log[1].target.pet.as_deref(), Some("a-1"));
}

#[test]
#[should_panic(expected = "only $CATCHAMI is accepted")]
fn rejects_other_tokens() {
    let mut c = setup();
    ctx("fake-token.near", 1);
    let _ = c.ft_on_transfer(a("alice.near"), U128(1), "\"deposit_user\"".into());
}

#[test]
fn settlement_must_balance_and_respect_allowances() {
    let mut c = setup();
    mint(&mut c, "a-1", "alice.near");
    deposit(&mut c, "x.near", 100 * ONE, r#"{"deposit_pet":{"token_id":"a-1"}}"#);
    deposit(&mut c, "hq.near", 500 * ONE, "\"deposit_hq\"");
    // Pet owner authorizes up to 10/day of gameplay spending.
    ctx("alice.near", 1);
    c.set_pet_allowance("a-1".into(), U128(10 * ONE));
    ctx("operator.near", 1);
    // Food: pet pays 1, 90/10 split.
    c.settle(U64(0), vec![d(Bucket::Pet("a-1".into()), -(ONE as i128)), d(Bucket::Hq, (ONE * 9 / 10) as i128), d(Bucket::Team, (ONE / 10) as i128)], H.into(), vec![]);
    assert_eq!(c.balance_of(Bucket::Pet("a-1".into())).balance.0, 99 * ONE);
    assert_eq!(c.balance_of(Bucket::Team).balance.0, ONE / 10);
    // Merchant sale: HQ -> merchants -> pet.
    c.settle(U64(1), vec![d(Bucket::Hq, -(200 * ONE as i128)), d(Bucket::Merchants, (200 * ONE) as i128)], H.into(), vec![]);
    c.settle(U64(2), vec![d(Bucket::Merchants, -(5 * ONE as i128)), d(Bucket::Pet("a-1".into()), (5 * ONE) as i128)], H.into(), vec![]);
    assert_eq!(c.balance_of(Bucket::Pet("a-1".into())).balance.0, 104 * ONE);
    assert_eq!(c.total_liabilities().0, 600 * ONE); // settlement never changes the total
}

#[test]
#[should_panic(expected = "batch does not balance")]
fn unbalanced_batch_rejected() {
    let mut c = setup();
    deposit(&mut c, "hq.near", 500 * ONE, "\"deposit_hq\"");
    ctx("operator.near", 1);
    c.settle(U64(0), vec![d(Bucket::Hq, -(10 * ONE as i128)), d(Bucket::Merchants, (11 * ONE) as i128)], H.into(), vec![]);
}

#[test]
#[should_panic(expected = "unexpected batch id")]
fn replayed_batch_rejected() {
    let mut c = setup();
    deposit(&mut c, "hq.near", 500 * ONE, "\"deposit_hq\"");
    ctx("operator.near", 1);
    c.settle(U64(0), vec![d(Bucket::Hq, -(ONE as i128)), d(Bucket::Merchants, ONE as i128)], H.into(), vec![]);
    c.settle(U64(0), vec![d(Bucket::Hq, -(ONE as i128)), d(Bucket::Merchants, ONE as i128)], H.into(), vec![]);
}

#[test]
#[should_panic(expected = "team bucket cannot be debited")]
fn operator_cannot_touch_team() {
    let mut c = setup();
    deposit(&mut c, "x.near", 10 * ONE, "\"deposit_hq\"");
    ctx("operator.near", 1);
    c.settle(U64(0), vec![d(Bucket::Hq, -(ONE as i128)), d(Bucket::Team, ONE as i128)], H.into(), vec![]);
    c.settle(U64(1), vec![d(Bucket::Team, -(ONE as i128)), d(Bucket::Hq, ONE as i128)], H.into(), vec![]);
}

#[test]
#[should_panic(expected = "daily limit exceeded for pet allowance")]
fn pet_cannot_be_drained_without_owner_allowance() {
    let mut c = setup();
    mint(&mut c, "a-1", "alice.near");
    deposit(&mut c, "x.near", 100 * ONE, r#"{"deposit_pet":{"token_id":"a-1"}}"#);
    ctx("operator.near", 1);
    c.settle(U64(0), vec![d(Bucket::Pet("a-1".into()), -(ONE as i128)), d(Bucket::Hq, ONE as i128)], H.into(), vec![]);
}

#[test]
#[should_panic(expected = "daily limit exceeded for HQ")]
fn hq_hard_cap_enforced() {
    let mut c = setup();
    deposit(&mut c, "x.near", 5_000 * ONE, "\"deposit_hq\"");
    ctx("operator.near", 1);
    c.settle(U64(0), vec![d(Bucket::Hq, -(1_001 * ONE as i128)), d(Bucket::Merchants, (1_001 * ONE) as i128)], H.into(), vec![]);
}

#[test]
#[should_panic(expected = "cannot exceed the published hard cap")]
fn owner_cannot_raise_hq_cap() {
    let mut c = setup();
    ctx("owner.near", 1);
    c.set_hq_daily_cap(U128(1_001 * ONE));
}

#[test]
fn withdrawal_reserves_funds_and_escape_hatch_works() {
    let mut c = setup();
    deposit(&mut c, "alice.near", 100 * ONE, "\"deposit_user\"");
    ctx("alice.near", 1_000);
    c.set_spend_allowance(U128(100 * ONE));
    let id = c.request_withdrawal(Bucket::User(a("alice.near")), U128(80 * ONE));
    assert_eq!(c.balance_of(Bucket::User(a("alice.near"))).available.0, 20 * ONE);
    // Too early, not acked.
    let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { ctx("alice.near", 2_000); c.execute_withdrawal(id); }));
    assert!(early.is_err());
    // After the 24h delay the user can exit without the operator.
    ctx("alice.near", 1_000 + 24 * HOUR_NS);
    let _ = c.execute_withdrawal(id);
    assert_eq!(c.balance_of(Bucket::User(a("alice.near"))).balance.0, 20 * ONE);
    assert_eq!(c.total_liabilities().0, 20 * ONE);
}

#[test]
fn operator_settles_racing_spend_only_within_grace() {
    let mut c = setup();
    deposit(&mut c, "alice.near", 100 * ONE, "\"deposit_user\"");
    ctx("alice.near", 1_000);
    c.set_spend_allowance(U128(100 * ONE));
    let id = c.request_withdrawal(Bucket::User(a("alice.near")), U128(100 * ONE));
    // A catch she paid for offchain 1 minute before the request lands in the next batch.
    ctx("operator.near", 1_000 + 60 * 1_000_000_000);
    c.settle(U64(0), vec![d(Bucket::User(a("alice.near")), -(3 * ONE as i128)), d(Bucket::Hq, (3 * ONE) as i128)], H.into(), vec![id]);
    let w = c.withdrawals_since(0, 1).remove(0);
    assert_eq!(w.amount.0, 97 * ONE);
    assert!(w.acked);
    // Acked: executable immediately.
    ctx("alice.near", 1_000 + 61 * 1_000_000_000);
    let _ = c.execute_withdrawal(id);
    assert_eq!(c.balance_of(Bucket::User(a("alice.near"))).balance.0, 0);
}

#[test]
#[should_panic(expected = "debit exceeds unreserved balance")]
fn operator_cannot_eat_old_withdrawal() {
    let mut c = setup();
    deposit(&mut c, "alice.near", 100 * ONE, "\"deposit_user\"");
    ctx("alice.near", 1_000);
    c.set_spend_allowance(U128(100 * ONE));
    c.request_withdrawal(Bucket::User(a("alice.near")), U128(100 * ONE));
    ctx("operator.near", 1_000 + SETTLE_GRACE_NS + 1);
    c.settle(U64(0), vec![d(Bucket::User(a("alice.near")), -(ONE as i128)), d(Bucket::Hq, ONE as i128)], H.into(), vec![]);
}

#[test]
fn marketplace_sale_is_atomic_and_moves_balance_with_nft() {
    let mut c = setup();
    mint(&mut c, "a-7", "alice.near");
    deposit(&mut c, "alice.near", 40 * ONE, r#"{"deposit_pet":{"token_id":"a-7"}}"#);
    ctx("alice.near", 1);
    c.list("a-7".into(), U128(100 * ONE));
    // Stale balance expectation => full refund, nothing moves.
    let refund = deposit(&mut c, "bob.near", 100 * ONE, r#"{"buy":{"token_id":"a-7","expected_pet_balance":"41000000000000000000"}}"#);
    assert_eq!(refund, 100 * ONE);
    assert_eq!(c.nft_token("a-7".into()).unwrap().owner_id, a("alice.near"));
    // Overpay => excess refunded; sale goes through.
    let refund = deposit(&mut c, "bob.near", 120 * ONE, r#"{"buy":{"token_id":"a-7","expected_pet_balance":"40000000000000000000"}}"#);
    assert_eq!(refund, 20 * ONE);
    assert_eq!(c.nft_token("a-7".into()).unwrap().owner_id, a("bob.near"));
    assert_eq!(c.balance_of(Bucket::Pet("a-7".into())).balance.0, 40 * ONE);
    assert_eq!(c.balance_of(Bucket::User(a("alice.near"))).balance.0, 98 * ONE);
    assert_eq!(c.balance_of(Bucket::Hq).balance.0, 2 * ONE * 9 / 10);
    assert_eq!(c.balance_of(Bucket::Team).balance.0, 2 * ONE / 10);
    assert!(c.get_listing("a-7".into()).is_none());
    // Double-buy refunds.
    assert_eq!(deposit(&mut c, "carol.near", 100 * ONE, r#"{"buy":{"token_id":"a-7","expected_pet_balance":null}}"#), 100 * ONE);
    assert_eq!(c.total_liabilities().0, 140 * ONE);
}

#[test]
fn old_owner_cannot_withdraw_pet_after_sale() {
    let mut c = setup();
    mint(&mut c, "a-9", "alice.near");
    deposit(&mut c, "alice.near", 40 * ONE, r#"{"deposit_pet":{"token_id":"a-9"}}"#);
    ctx("alice.near", 1);
    let id = c.request_withdrawal(Bucket::Pet("a-9".into()), U128(40 * ONE));
    // Alice transfers the NFT to Bob while her request is pending.
    c.nft_transfer(a("bob.near"), "a-9".into(), None, None);
    ctx("alice.near", 1 + 25 * HOUR_NS);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = c.execute_withdrawal(id); }));
    assert!(r.is_err());
    assert_eq!(c.balance_of(Bucket::Pet("a-9".into())).balance.0, 40 * ONE);
}

#[test]
#[should_panic(expected = "operator only")]
fn only_operator_mints() {
    let mut c = setup();
    ctx("alice.near", 1);
    c.mint("a-1".into(), a("alice.near"), TokenMetadata { title: None, description: None, media: None, media_hash: None, copies: None, issued_at: None, expires_at: None, starts_at: None, updated_at: None, extra: None, reference: None, reference_hash: None });
}
