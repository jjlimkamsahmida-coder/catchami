//! Catchami game contract: animal + equipment NFTs (NEP-171), the $CATCHAMI
//! vault with per-pet balances, operator settlement with hard limits, delayed
//! withdrawals with an escape hatch, and an atomic in-game marketplace.
//!
//! Trust model (see docs/ARCHITECTURE.md):
//! * The OWNER (a multisig/DAO) can rotate the operator, pause, and lower
//!   budgets. It can never move or edit anyone's balance.
//! * The OPERATOR (game server) mints NFTs and submits settlement batches.
//!   Batches must sum to zero, are sequence-numbered (no replay), can never
//!   debit the team bucket, and are capped per day: HQ by a hard limit fixed
//!   at init, each pet/user by an allowance its owner signed.
//! * Players can always exit: a withdrawal request becomes executable after
//!   the operator acknowledges it, or automatically after the delay.
//! * Balances follow the NFT: a pet's balance belongs to whoever owns it.
//!
//! DRAFT — not audited. Do not deploy with real funds before an independent review.

use near_contract_standards::fungible_token::core::ext_ft_core;
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::non_fungible_token::core::{NonFungibleTokenCore, NonFungibleTokenResolver};
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::json_types::{I128, U128, U64};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};
use std::collections::HashMap;

const NS_PER_DAY: u64 = 86_400 * 1_000_000_000;
const HOUR_NS: u64 = 3_600 * 1_000_000_000;
/// Operator may still settle spends into funds reserved by a withdrawal request this young.
const SETTLE_GRACE_NS: u64 = 10 * 60 * 1_000_000_000;
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_CALLBACK: Gas = Gas::from_tgas(10);
pub const MARKET_FEE_BPS: u128 = 200;
pub const FEE_HQ_BPS: u128 = 9_000;

#[derive(BorshStorageKey)]
#[near]
enum Key {
    OwnerById,
    TokenMetadata,
    Enumeration,
    Users,
    Pets,
    PetAllowance,
    UserAllowance,
    DayDebits,
    Reserved,
    Withdrawals,
    Deposits,
    Listings,
    NftMeta,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum Bucket {
    User(AccountId),
    Pet(TokenId),
    Hq,
    Team,
    Merchants,
}

#[near(serializers = [json])]
pub struct Delta {
    pub bucket: Bucket,
    pub amount: I128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum WithdrawalStatus {
    Pending,
    Executing,
    Executed,
    Cancelled,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct WithdrawalRequest {
    pub id: U64,
    pub account: AccountId,
    pub source: Bucket,
    pub amount: U128,
    pub created_at: U64,
    pub acked: bool,
    pub status: WithdrawalStatus,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct DepositTarget {
    pub user: Option<AccountId>,
    pub pet: Option<TokenId>,
    pub hq: Option<bool>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct DepositRecord {
    pub seq: u64,
    pub sender: AccountId,
    pub amount: U128,
    pub target: DepositTarget,
    pub block: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Listing {
    pub token_id: TokenId,
    pub seller: AccountId,
    pub price: U128,
}

#[near(serializers = [json])]
#[serde(rename_all = "snake_case")]
enum TransferMsg {
    DepositUser,
    DepositPet { token_id: TokenId },
    DepositHq,
    Buy { token_id: TokenId, expected_pet_balance: Option<U128> },
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    operator: AccountId,
    token: AccountId,
    team_account: AccountId,
    paused: bool,
    nft: NonFungibleToken,
    nft_meta: near_sdk::store::LazyOption<NFTContractMetadata>,
    users: LookupMap<AccountId, u128>,
    pets: LookupMap<TokenId, u128>,
    hq: u128,
    team: u128,
    merchants: u128,
    /// Sum of all buckets: what the vault owes. Invariant: <= ft_balance_of(this).
    total_liabilities: u128,
    pet_allowance: LookupMap<TokenId, u128>,
    user_allowance: LookupMap<AccountId, u128>,
    /// key -> (day, debited) for daily caps.
    day_debits: LookupMap<String, (u64, u128)>,
    /// Funds reserved by pending withdrawal requests, per bucket key.
    reserved: LookupMap<String, u128>,
    withdrawals: Vector<WithdrawalRequest>,
    withdrawal_delay_ns: u64,
    deposits: Vector<DepositRecord>,
    listings: LookupMap<TokenId, Listing>,
    next_batch: u64,
    /// Immutable hard limit on HQ debits per day; the owner may only set a lower cap.
    hq_daily_hard_cap: u128,
    hq_daily_cap: u128,
}

fn key(b: &Bucket) -> String {
    match b {
        Bucket::User(a) => format!("u:{a}"),
        Bucket::Pet(t) => format!("p:{t}"),
        Bucket::Hq => "hq".into(),
        Bucket::Team => "team".into(),
        Bucket::Merchants => "merchants".into(),
    }
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, operator: AccountId, token: AccountId, team_account: AccountId, hq_daily_hard_cap: U128) -> Self {
        require!(owner != operator, "owner and operator must differ");
        let meta = NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Catchami".to_string(),
            symbol: "CATCHAMI-PET".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        };
        Self {
            owner,
            operator,
            token,
            team_account,
            paused: false,
            nft: NonFungibleToken::new(Key::OwnerById, env::current_account_id(), Some(Key::TokenMetadata), Some(Key::Enumeration), None::<Key>),
            nft_meta: near_sdk::store::LazyOption::new(Key::NftMeta, Some(meta)),
            users: LookupMap::new(Key::Users),
            pets: LookupMap::new(Key::Pets),
            hq: 0,
            team: 0,
            merchants: 0,
            total_liabilities: 0,
            pet_allowance: LookupMap::new(Key::PetAllowance),
            user_allowance: LookupMap::new(Key::UserAllowance),
            day_debits: LookupMap::new(Key::DayDebits),
            reserved: LookupMap::new(Key::Reserved),
            withdrawals: Vector::new(Key::Withdrawals),
            withdrawal_delay_ns: 24 * HOUR_NS,
            deposits: Vector::new(Key::Deposits),
            listings: LookupMap::new(Key::Listings),
            next_batch: 0,
            hq_daily_hard_cap: hq_daily_hard_cap.0,
            hq_daily_cap: hq_daily_hard_cap.0,
        }
    }

    // ---------------------------------------------------------------- admin

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }
    fn assert_operator(&self) {
        require!(env::predecessor_account_id() == self.operator, "operator only");
    }
    fn assert_live(&self) {
        require!(!self.paused, "paused");
    }

    pub fn set_operator(&mut self, operator: AccountId) {
        self.assert_owner();
        require!(operator != self.owner, "owner and operator must differ");
        env::log_str(&format!("operator rotated: {} -> {}", self.operator, operator));
        self.operator = operator;
    }

    /// Pauses deposits, settlement, minting and the marketplace. Withdrawal
    /// requests and their execution are never pausable.
    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
        env::log_str(&format!("paused={paused}"));
    }

    pub fn set_hq_daily_cap(&mut self, cap: U128) {
        self.assert_owner();
        require!(cap.0 <= self.hq_daily_hard_cap, "cannot exceed the published hard cap");
        self.hq_daily_cap = cap.0;
    }

    pub fn set_withdrawal_delay_hours(&mut self, hours: u64) {
        self.assert_owner();
        require!((1..=72).contains(&hours), "delay must be 1..72h");
        self.withdrawal_delay_ns = hours * HOUR_NS;
    }

    // ------------------------------------------------------------- balances

    fn get(&self, b: &Bucket) -> u128 {
        match b {
            Bucket::User(a) => *self.users.get(a).unwrap_or(&0),
            Bucket::Pet(t) => *self.pets.get(t).unwrap_or(&0),
            Bucket::Hq => self.hq,
            Bucket::Team => self.team,
            Bucket::Merchants => self.merchants,
        }
    }

    fn put(&mut self, b: &Bucket, v: u128) {
        match b {
            Bucket::User(a) => { self.users.insert(a.clone(), v); }
            Bucket::Pet(t) => { self.pets.insert(t.clone(), v); }
            Bucket::Hq => self.hq = v,
            Bucket::Team => self.team = v,
            Bucket::Merchants => self.merchants = v,
        }
    }

    fn reserved_of(&self, b: &Bucket) -> u128 {
        *self.reserved.get(&key(b)).unwrap_or(&0)
    }

    fn credit(&mut self, b: &Bucket, amount: u128) {
        let v = self.get(b).checked_add(amount).expect("overflow");
        self.put(b, v);
    }

    fn debit(&mut self, b: &Bucket, amount: u128) {
        let v = self.get(b).checked_sub(amount).expect("insufficient balance");
        self.put(b, v);
    }

    fn day_debit(&mut self, k: String, amount: u128, cap: u128, what: &str) {
        let today = env::block_timestamp() / NS_PER_DAY;
        let (day, used) = *self.day_debits.get(&k).unwrap_or(&(today, 0));
        let used = if day == today { used } else { 0 };
        let next = used.checked_add(amount).expect("overflow");
        require!(next <= cap, format!("daily limit exceeded for {what}"));
        self.day_debits.insert(k, (today, next));
    }

    fn token_owner(&self, token_id: &TokenId) -> AccountId {
        self.nft.owner_by_id.get(token_id).expect("no such token")
    }

    /// Daily amount the operator may spend from this pet on gameplay (food, medicine, crafting, catches).
    pub fn set_pet_allowance(&mut self, token_id: TokenId, daily_max: U128) {
        require!(self.token_owner(&token_id) == env::predecessor_account_id(), "not the owner");
        self.pet_allowance.insert(token_id, daily_max.0);
    }

    pub fn set_spend_allowance(&mut self, daily_max: U128) {
        self.user_allowance.insert(env::predecessor_account_id(), daily_max.0);
    }

    // --------------------------------------------------------------- minting

    pub fn mint(&mut self, token_id: TokenId, owner_id: AccountId, metadata: TokenMetadata) -> Token {
        self.assert_operator();
        self.assert_live();
        require!(token_id.starts_with("a-") || token_id.starts_with("e-"), "token id must start with a- (animal) or e- (equipment)");
        self.nft.internal_mint_with_refund(token_id, owner_id, Some(metadata), None)
    }

    // ------------------------------------------------------------ settlement

    /// Apply a batch of offchain ledger results. Must sum to zero.
    pub fn settle(&mut self, batch_id: U64, deltas: Vec<Delta>, journal_hash: String, ack_withdrawals: Vec<U64>) {
        self.assert_operator();
        self.assert_live();
        require!(batch_id.0 == self.next_batch, "unexpected batch id (replay or gap)");
        require!(journal_hash.len() == 64, "journal_hash must be a sha256 hex digest");
        self.next_batch += 1;
        let mut sum: i128 = 0;
        for d in &deltas {
            sum = sum.checked_add(d.amount.0).expect("overflow");
        }
        require!(sum == 0, "batch does not balance");
        // Debits first (so credits can't fund debits within the same bucket ordering games).
        let now = env::block_timestamp();
        for d in deltas.iter().filter(|d| d.amount.0 < 0) {
            let amt = d.amount.0.unsigned_abs();
            match &d.bucket {
                Bucket::Team => env::panic_str("team bucket cannot be debited by settlement"),
                Bucket::Hq => { let cap = self.hq_daily_cap; self.day_debit("hq".into(), amt, cap, "HQ") }
                Bucket::Pet(t) => {
                    let cap = *self.pet_allowance.get(t).unwrap_or(&0);
                    self.day_debit(format!("p:{t}"), amt, cap, "pet allowance");
                }
                Bucket::User(a) => {
                    let cap = *self.user_allowance.get(a).unwrap_or(&0);
                    self.day_debit(format!("u:{a}"), amt, cap, "user allowance");
                }
                Bucket::Merchants => {}
            }
            let bal = self.get(&d.bucket);
            let reserved = self.reserved_of(&d.bucket);
            let free = bal.saturating_sub(reserved);
            if amt > free {
                // Only spends racing a brand-new withdrawal request may shrink it.
                self.shrink_young_requests(&d.bucket, amt - free, now);
            }
            self.debit(&d.bucket, amt);
        }
        for d in deltas.iter().filter(|d| d.amount.0 > 0) {
            self.credit(&d.bucket, d.amount.0 as u128);
        }
        for id in ack_withdrawals {
            if let Some(w) = self.withdrawals.get_mut(id.0 as u32) {
                if w.status == WithdrawalStatus::Pending {
                    w.acked = true;
                }
            }
        }
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"catchami\",\"version\":\"1.0.0\",\"event\":\"settle\",\"data\":{{\"batch\":{},\"journal_hash\":\"{}\",\"deltas\":{}}}}}", batch_id.0, journal_hash, deltas.len()));
    }

    fn shrink_young_requests(&mut self, b: &Bucket, mut need: u128, now: u64) {
        let k = key(b);
        let n = self.withdrawals.len();
        let mut i = n;
        while i > 0 && need > 0 {
            i -= 1;
            let w = self.withdrawals.get_mut(i).unwrap();
            if w.status != WithdrawalStatus::Pending || key(&w.source) != k {
                continue;
            }
            if now.saturating_sub(w.created_at.0) > SETTLE_GRACE_NS {
                break; // older requests are untouchable
            }
            let cut = need.min(w.amount.0);
            w.amount = U128(w.amount.0 - cut);
            if w.amount.0 == 0 {
                w.status = WithdrawalStatus::Cancelled;
            }
            need -= cut;
            let r = self.reserved_of(b) - cut;
            self.reserved.insert(k.clone(), r);
        }
        require!(need == 0, "debit exceeds unreserved balance");
    }

    // ----------------------------------------------------------- withdrawals

    /// Ask to withdraw from your user bucket or a pet you own. Funds are
    /// reserved immediately and can't be spent or sold.
    pub fn request_withdrawal(&mut self, source: Bucket, amount: U128) -> U64 {
        let caller = env::predecessor_account_id();
        require!(amount.0 > 0, "amount must be positive");
        match &source {
            Bucket::User(a) => require!(*a == caller, "not your account"),
            Bucket::Pet(t) => {
                require!(self.token_owner(t) == caller, "not the pet owner");
                require!(self.listings.get(t).is_none(), "cancel the listing first");
            }
            _ => env::panic_str("only user or pet buckets can be withdrawn"),
        }
        let free = self.get(&source).saturating_sub(self.reserved_of(&source));
        require!(amount.0 <= free, "insufficient available balance");
        let k = key(&source);
        let r = self.reserved_of(&source) + amount.0;
        self.reserved.insert(k, r);
        let id = self.withdrawals.len() as u64;
        self.withdrawals.push(WithdrawalRequest { id: U64(id), account: caller, source, amount, created_at: U64(env::block_timestamp()), acked: false, status: WithdrawalStatus::Pending });
        U64(id)
    }

    pub fn cancel_withdrawal(&mut self, id: U64) {
        let w = self.withdrawals.get(id.0 as u32).cloned().expect("no such request");
        require!(w.account == env::predecessor_account_id(), "not your request");
        require!(w.status == WithdrawalStatus::Pending, "not pending");
        self.release_request(id.0 as u32, WithdrawalStatus::Cancelled);
    }

    fn release_request(&mut self, idx: u32, status: WithdrawalStatus) {
        let w = self.withdrawals.get_mut(idx).unwrap();
        let (src, amt) = (w.source.clone(), w.amount.0);
        w.status = status;
        let r = self.reserved_of(&src).saturating_sub(amt);
        self.reserved.insert(key(&src), r);
    }

    /// Executable once acknowledged by the operator, or after the delay (escape hatch).
    pub fn execute_withdrawal(&mut self, id: U64) -> Promise {
        let idx = id.0 as u32;
        let w = self.withdrawals.get(idx).cloned().expect("no such request");
        require!(w.account == env::predecessor_account_id(), "not your request");
        require!(w.status == WithdrawalStatus::Pending, "not pending");
        require!(w.acked || env::block_timestamp() >= w.created_at.0 + self.withdrawal_delay_ns, "withdrawal delay not over yet");
        if let Bucket::Pet(t) = &w.source {
            if self.token_owner(t) != w.account {
                // Pet changed hands: the request dies with the sale.
                self.release_request(idx, WithdrawalStatus::Cancelled);
                env::panic_str("pet no longer owned by requester");
            }
        }
        self.release_request(idx, WithdrawalStatus::Executing);
        self.debit(&w.source, w.amount.0);
        self.total_liabilities -= w.amount.0;
        ext_ft_core::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(w.account.clone(), w.amount, Some(format!("catchami withdrawal {}", id.0)))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_withdrawal(id))
    }

    #[private]
    pub fn on_withdrawal(&mut self, id: U64) -> bool {
        let ok = env::promise_result_checked(0, 256).is_ok();
        let w = self.withdrawals.get_mut(id.0 as u32).unwrap();
        if ok {
            w.status = WithdrawalStatus::Executed;
        } else {
            // Transfer failed (e.g. receiver not registered): restore funds; request back to pending.
            w.status = WithdrawalStatus::Pending;
            let (src, amt) = (w.source.clone(), w.amount.0);
            self.credit(&src, amt);
            self.total_liabilities += amt;
            let r = self.reserved_of(&src) + amt;
            self.reserved.insert(key(&src), r);
        }
        ok
    }

    /// The team withdraws accrued fee revenue directly (it only ever increases via fees).
    pub fn withdraw_team(&mut self, amount: U128) -> Promise {
        require!(env::predecessor_account_id() == self.team_account, "team account only");
        self.debit(&Bucket::Team, amount.0);
        self.total_liabilities -= amount.0;
        ext_ft_core::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(self.team_account.clone(), amount, Some("catchami team revenue".into()))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_team_withdrawal(amount))
    }

    #[private]
    pub fn on_team_withdrawal(&mut self, amount: U128) -> bool {
        let ok = env::promise_result_checked(0, 256).is_ok();
        if !ok {
            self.credit(&Bucket::Team, amount.0);
            self.total_liabilities += amount.0;
        }
        ok
    }

    // ----------------------------------------------------------- marketplace

    pub fn list(&mut self, token_id: TokenId, price: U128) {
        self.assert_live();
        let caller = env::predecessor_account_id();
        require!(self.token_owner(&token_id) == caller, "not the owner");
        require!(price.0 > 0, "price must be positive");
        require!(self.reserved_of(&Bucket::Pet(token_id.clone())) == 0, "pet has a pending withdrawal");
        self.listings.insert(token_id.clone(), Listing { token_id, seller: caller, price });
    }

    pub fn cancel_listing(&mut self, token_id: TokenId) {
        let l = self.listings.get(&token_id).cloned().expect("not listed");
        require!(l.seller == env::predecessor_account_id(), "not your listing");
        self.listings.remove(&token_id);
    }

    fn before_transfer(&mut self, token_id: &TokenId) {
        self.listings.remove(token_id);
        // Pending pet withdrawals are cancelled lazily at execution (owner check).
    }

    /// Atomic purchase inside ft_on_transfer. Returns the unused amount (refund).
    fn buy(&mut self, buyer: AccountId, amount: u128, token_id: TokenId, expected: Option<U128>) -> u128 {
        let Some(l) = self.listings.get(&token_id).cloned() else {
            env::log_str("listing not found — refunded");
            return amount;
        };
        if self.paused || l.seller == buyer || amount < l.price.0 || self.token_owner(&token_id) != l.seller {
            env::log_str("purchase rejected — refunded");
            return amount;
        }
        if let Some(e) = expected {
            if self.get(&Bucket::Pet(token_id.clone())) < e.0 {
                env::log_str("pet balance below expected — refunded");
                return amount;
            }
        }
        let price = l.price.0;
        let fee = price * MARKET_FEE_BPS / 10_000;
        let fee_hq = fee * FEE_HQ_BPS / 10_000;
        self.listings.remove(&token_id);
        self.nft.internal_transfer(&l.seller, &buyer, &token_id, None, Some("catchami market".into()));
        self.credit(&Bucket::User(l.seller.clone()), price - fee);
        self.credit(&Bucket::Hq, fee_hq);
        self.credit(&Bucket::Team, fee - fee_hq);
        self.total_liabilities += price;
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"catchami\",\"version\":\"1.0.0\",\"event\":\"sale\",\"data\":{{\"token_id\":\"{}\",\"seller\":\"{}\",\"buyer\":\"{}\",\"price\":\"{}\"}}}}", token_id, l.seller, buyer, price));
        amount - price
    }

    // ----------------------------------------------------------------- views

    pub fn balance_of(&self, bucket: Bucket) -> serde_json_balance::Balance {
        let b = self.get(&bucket);
        let r = self.reserved_of(&bucket);
        serde_json_balance::Balance { balance: U128(b), reserved: U128(r), available: U128(b.saturating_sub(r)) }
    }
    pub fn total_liabilities(&self) -> U128 {
        U128(self.total_liabilities)
    }
    pub fn deposits_since(&self, from_seq: u64, limit: u64) -> Vec<DepositRecord> {
        let n = self.deposits.len() as u64;
        (from_seq..n.min(from_seq + limit.min(200))).map(|i| self.deposits.get(i as u32).unwrap().clone()).collect()
    }
    pub fn withdrawals_since(&self, from_id: u64, limit: u64) -> Vec<WithdrawalRequest> {
        let n = self.withdrawals.len() as u64;
        (from_id..n.min(from_id + limit.min(200))).map(|i| self.withdrawals.get(i as u32).unwrap().clone()).collect()
    }
    pub fn get_listing(&self, token_id: TokenId) -> Option<Listing> {
        self.listings.get(&token_id).cloned()
    }
    pub fn config(&self) -> HashMap<String, String> {
        HashMap::from([
            ("owner".into(), self.owner.to_string()),
            ("operator".into(), self.operator.to_string()),
            ("token".into(), self.token.to_string()),
            ("team_account".into(), self.team_account.to_string()),
            ("paused".into(), self.paused.to_string()),
            ("next_batch".into(), self.next_batch.to_string()),
            ("hq_daily_hard_cap".into(), self.hq_daily_hard_cap.to_string()),
            ("hq_daily_cap".into(), self.hq_daily_cap.to_string()),
            ("withdrawal_delay_hours".into(), (self.withdrawal_delay_ns / HOUR_NS).to_string()),
        ])
    }
}

pub mod serde_json_balance {
    use near_sdk::json_types::U128;
    use near_sdk::near;
    #[near(serializers = [json])]
    pub struct Balance {
        pub balance: U128,
        pub reserved: U128,
        pub available: U128,
    }
}

#[near]
impl FungibleTokenReceiver for Contract {
    /// Deposits and purchases. Only $CATCHAMI is accepted.
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.token, "only $CATCHAMI is accepted");
        let parsed: TransferMsg = near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("invalid msg"));
        if let TransferMsg::Buy { token_id, expected_pet_balance } = parsed {
            return PromiseOrValue::Value(U128(self.buy(sender_id, amount.0, token_id, expected_pet_balance)));
        }
        self.assert_live();
        let (bucket, target) = match parsed {
            TransferMsg::DepositUser => (Bucket::User(sender_id.clone()), DepositTarget { user: Some(sender_id.clone()), pet: None, hq: None }),
            TransferMsg::DepositPet { token_id } => {
                require!(self.nft.owner_by_id.get(&token_id).is_some(), "no such pet");
                (Bucket::Pet(token_id.clone()), DepositTarget { user: None, pet: Some(token_id), hq: None })
            }
            TransferMsg::DepositHq => (Bucket::Hq, DepositTarget { user: None, pet: None, hq: Some(true) }),
            TransferMsg::Buy { .. } => unreachable!(),
        };
        self.credit(&bucket, amount.0);
        self.total_liabilities += amount.0;
        let seq = self.deposits.len() as u64;
        self.deposits.push(DepositRecord { seq, sender: sender_id, amount, target, block: env::block_height() });
        PromiseOrValue::Value(U128(0))
    }
}

#[near]
impl NonFungibleTokenCore for Contract {
    #[payable]
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>) {
        self.before_transfer(&token_id);
        self.nft.nft_transfer(receiver_id, token_id, approval_id, memo)
    }
    #[payable]
    fn nft_transfer_call(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>, msg: String) -> PromiseOrValue<bool> {
        self.before_transfer(&token_id);
        self.nft.nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }
    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.nft.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for Contract {
    #[private]
    fn nft_resolve_transfer(&mut self, previous_owner_id: AccountId, receiver_id: AccountId, token_id: TokenId, approved_account_ids: Option<HashMap<AccountId, u64>>) -> bool {
        self.nft.nft_resolve_transfer(previous_owner_id, receiver_id, token_id, approved_account_ids)
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Contract {
    fn nft_metadata(&self) -> NFTContractMetadata {
        self.nft_meta.get().clone().unwrap()
    }
}

#[cfg(test)]
mod tests;
