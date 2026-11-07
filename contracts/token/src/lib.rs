//! $CATCHAMI — fixed-supply NEP-141 fungible token.
//!
//! * Total supply: 100,000,000,000,000 tokens x 10^18 (fits u128).
//! * Minted exactly once in `new` to three allocation accounts:
//!   40% game HQ allocation, 55% market distribution/liquidity, 5% team
//!   (the team account should be a vesting/lockup contract, see docs/SETUP.md).
//! * There is NO mint function. Supply can never increase.
//!
//! DRAFT — not audited. Do not deploy to mainnet before an independent review.

use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{
    log, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue,
};

pub const DECIMALS: u8 = 18;
pub const ONE: u128 = 1_000_000_000_000_000_000;
pub const TOTAL_SUPPLY: u128 = 100_000_000_000_000 * ONE;
pub const HQ_SHARE: u128 = 40_000_000_000_000 * ONE;
pub const MARKET_SHARE: u128 = 55_000_000_000_000 * ONE;
pub const TEAM_SHARE: u128 = 5_000_000_000_000 * ONE;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Ft,
    Metadata,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    metadata: near_sdk::store::LazyOption<FungibleTokenMetadata>,
}

#[near]
impl Contract {
    /// One-shot initialization. `icon` should be a small data-URL SVG.
    #[init]
    pub fn new(hq_allocation: AccountId, market_allocation: AccountId, team_allocation: AccountId, icon: Option<String>) -> Self {
        require!(hq_allocation != market_allocation && hq_allocation != team_allocation && market_allocation != team_allocation, "allocation accounts must differ");
        require!(HQ_SHARE + MARKET_SHARE + TEAM_SHARE == TOTAL_SUPPLY, "allocation mismatch");
        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Catchami".to_string(),
            symbol: "CATCHAMI".to_string(),
            icon,
            reference: None,
            reference_hash: None,
            decimals: DECIMALS,
        };
        metadata.assert_valid();
        let mut this = Self {
            token: FungibleToken::new(StorageKey::Ft),
            metadata: near_sdk::store::LazyOption::new(StorageKey::Metadata, Some(metadata)),
        };
        for (acct, amount, label) in [
            (&hq_allocation, HQ_SHARE, "hq"),
            (&market_allocation, MARKET_SHARE, "market"),
            (&team_allocation, TEAM_SHARE, "team"),
        ] {
            this.token.internal_register_account(acct);
            this.token.internal_deposit(acct, amount);
            near_contract_standards::fungible_token::events::FtMint { owner_id: acct, amount: U128(amount), memo: Some(label) }.emit();
        }
        log!("CATCHAMI initialized: fixed supply {}", TOTAL_SUPPLY);
        this
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }
    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }
    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }
    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned > 0 {
            // Tokens sent to an account that unregistered mid-transfer are burned by the standard;
            // supply can only ever go down, never up.
            log!("{} tokens burned by unregistration", burned);
        }
        used.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }
    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        // Force-unregistering burns the caller's tokens; disallow to avoid accidental burns.
        require!(!force.unwrap_or(false), "force unregister is disabled");
        self.token.internal_storage_unregister(force).is_some()
    }
    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }
    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().clone().unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(pred: usize) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(accounts(pred)).current_account_id("catchami.near".parse().unwrap());
        b
    }

    #[test]
    fn supply_is_fixed_and_allocated_exactly() {
        testing_env!(ctx(0).build());
        let c = Contract::new(accounts(1), accounts(2), accounts(3), None);
        assert_eq!(c.ft_total_supply().0, TOTAL_SUPPLY);
        assert_eq!(c.ft_balance_of(accounts(1)).0, HQ_SHARE);
        assert_eq!(c.ft_balance_of(accounts(2)).0, MARKET_SHARE);
        assert_eq!(c.ft_balance_of(accounts(3)).0, TEAM_SHARE);
        assert_eq!(HQ_SHARE * 100 / TOTAL_SUPPLY, 40);
        assert_eq!(MARKET_SHARE * 100 / TOTAL_SUPPLY, 55);
        assert_eq!(TEAM_SHARE * 100 / TOTAL_SUPPLY, 5);
        assert_eq!(c.ft_metadata().symbol, "CATCHAMI");
        assert_eq!(c.ft_metadata().decimals, 18);
    }

    #[test]
    #[should_panic(expected = "allocation accounts must differ")]
    fn rejects_duplicate_allocation_accounts() {
        testing_env!(ctx(0).build());
        Contract::new(accounts(1), accounts(1), accounts(3), None);
    }

    #[test]
    fn transfers_preserve_supply() {
        testing_env!(ctx(0).build());
        let mut c = Contract::new(accounts(1), accounts(2), accounts(3), None);
        testing_env!(ctx(1).attached_deposit(NearToken::from_near(1)).build());
        c.storage_deposit(Some(accounts(4)), None);
        testing_env!(ctx(1).attached_deposit(NearToken::from_yoctonear(1)).build());
        c.ft_transfer(accounts(4), U128(5 * ONE), None);
        assert_eq!(c.ft_balance_of(accounts(4)).0, 5 * ONE);
        assert_eq!(c.ft_total_supply().0, TOTAL_SUPPLY);
    }
}
