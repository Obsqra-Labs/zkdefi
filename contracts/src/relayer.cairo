// Relayer: Enables private withdrawals to fresh addresses.
// Tier-gated: Tier 0 cannot use, Tier 1 has delay, Tier 2 is instant.

use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct RelayRequest {
    pub requester: ContractAddress,
    pub nullifier: felt252,
    pub commitment: felt252,
    pub amount: u256,
    pub recipient: ContractAddress,
    pub proof_hash: felt252,
    pub request_time: u64,
    pub executed: bool,
    pub fee_bps: u16,
}

#[starknet::interface]
pub trait IReputationRegistry<TContractState> {
    fn can_use_relayer(self: @TContractState, user: ContractAddress) -> bool;
    fn get_relayer_delay(self: @TContractState, user: ContractAddress) -> u64;
}

#[starknet::interface]
pub trait IConfidentialTransfer<TContractState> {
    fn private_withdraw(
        ref self: TContractState,
        nullifier: felt252,
        commitment: felt252,
        amount_public: u256,
        proof_calldata: Span<felt252>,
        recipient: ContractAddress
    );
}

#[starknet::interface]
pub trait IFactRegistry<TContractState> {
    fn is_valid(self: @TContractState, fact_hash: felt252) -> bool;
}

#[starknet::interface]
pub trait IRelayer<TContractState> {
    // User functions
    fn request_relay(
        ref self: TContractState,
        nullifier: felt252,
        commitment: felt252,
        amount: u256,
        recipient: ContractAddress,
        proof_hash: felt252
    ) -> u64;  // Returns request ID
    
    fn cancel_relay(ref self: TContractState, request_id: u64);
    fn get_relay_request(self: @TContractState, request_id: u64) -> RelayRequest;
    fn get_user_pending_relays(self: @TContractState, user: ContractAddress) -> Array<u64>;
    
    // Relayer execution
    fn execute_relay(ref self: TContractState, request_id: u64, proof_calldata: Span<felt252>);
    fn can_execute_relay(self: @TContractState, request_id: u64) -> bool;
    fn get_pending_count(self: @TContractState) -> u64;
    
    // Fee management
    fn get_relay_fee_bps(self: @TContractState, user: ContractAddress) -> u16;
    fn set_tier_fee(ref self: TContractState, tier: u8, fee_bps: u16);
    
    // Relayer registration
    fn register_relayer(ref self: TContractState);
    fn unregister_relayer(ref self: TContractState);
    fn is_relayer(self: @TContractState, address: ContractAddress) -> bool;
}

#[starknet::contract]
mod Relayer {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp, get_contract_address,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };
    
    use super::RelayRequest;
    use super::IReputationRegistryDispatcher;
    use super::IReputationRegistryDispatcherTrait;
    use super::IConfidentialTransferDispatcher;
    use super::IConfidentialTransferDispatcherTrait;
    use super::IFactRegistryDispatcher;
    use super::IFactRegistryDispatcherTrait;
    
    // Fees in basis points
    const TIER1_FEE_BPS: u16 = 50;  // 0.5%
    const TIER2_FEE_BPS: u16 = 10;  // 0.1%
    
    #[storage]
    struct Storage {
        reputation_registry: ContractAddress,
        confidential_transfer: ContractAddress,
        fact_registry: ContractAddress,
        admin: ContractAddress,
        
        // Relay requests
        relay_requests: Map<u64, RelayRequest>,
        next_request_id: u64,
        
        // User pending requests
        user_pending_count: Map<ContractAddress, u64>,
        user_pending_requests: Map<(ContractAddress, u64), u64>,
        
        // Registered relayers
        registered_relayers: Map<ContractAddress, bool>,
        relayer_count: u64,
        
        // Fee configuration
        tier1_fee_bps: u16,
        tier2_fee_bps: u16,
        
        // Stats
        total_relayed_volume: u256,
        total_fees_collected: u256,
    }
    
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        RelayRequested: RelayRequested,
        RelayCancelled: RelayCancelled,
        RelayExecuted: RelayExecuted,
        RelayerRegistered: RelayerRegistered,
        RelayerUnregistered: RelayerUnregistered,
    }
    
    #[derive(Drop, starknet::Event)]
    struct RelayRequested {
        #[key]
        requester: ContractAddress,
        request_id: u64,
        amount: u256,
        recipient: ContractAddress,
        ready_time: u64,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct RelayCancelled {
        #[key]
        requester: ContractAddress,
        request_id: u64,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct RelayExecuted {
        #[key]
        relayer: ContractAddress,
        request_id: u64,
        amount: u256,
        fee: u256,
        recipient: ContractAddress,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct RelayerRegistered {
        #[key]
        relayer: ContractAddress,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct RelayerUnregistered {
        #[key]
        relayer: ContractAddress,
        timestamp: u64,
    }
    
    #[constructor]
    fn constructor(
        ref self: ContractState,
        reputation_registry: ContractAddress,
        confidential_transfer: ContractAddress,
        fact_registry: ContractAddress,
        admin: ContractAddress
    ) {
        self.reputation_registry.write(reputation_registry);
        self.confidential_transfer.write(confidential_transfer);
        self.fact_registry.write(fact_registry);
        self.admin.write(admin);
        self.next_request_id.write(1);
        self.tier1_fee_bps.write(TIER1_FEE_BPS);
        self.tier2_fee_bps.write(TIER2_FEE_BPS);
    }
    
    #[abi(embed_v0)]
    impl RelayerImpl of super::IRelayer<ContractState> {
        fn request_relay(
            ref self: ContractState,
            nullifier: felt252,
            commitment: felt252,
            amount: u256,
            recipient: ContractAddress,
            proof_hash: felt252
        ) -> u64 {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            // Check tier allows relayer
            let rep_registry = IReputationRegistryDispatcher {
                contract_address: self.reputation_registry.read()
            };
            assert(rep_registry.can_use_relayer(caller), 'Tier does not allow relayer');
            
            // Verify proof in Integrity
            let fact_registry = IFactRegistryDispatcher {
                contract_address: self.fact_registry.read()
            };
            assert(fact_registry.is_valid(proof_hash), 'Invalid withdrawal proof');
            
            // Get fee for user's tier
            let fee_bps = self.get_relay_fee_bps(caller);
            let delay = rep_registry.get_relayer_delay(caller);
            
            // Create request
            let request_id = self.next_request_id.read();
            self.next_request_id.write(request_id + 1);
            
            self.relay_requests.write(request_id, RelayRequest {
                requester: caller,
                nullifier,
                commitment,
                amount,
                recipient,
                proof_hash,
                request_time: timestamp,
                executed: false,
                fee_bps,
            });
            
            // Track user pending
            let user_count = self.user_pending_count.read(caller);
            self.user_pending_requests.write((caller, user_count), request_id);
            self.user_pending_count.write(caller, user_count + 1);
            
            self.emit(RelayRequested {
                requester: caller,
                request_id,
                amount,
                recipient,
                ready_time: timestamp + delay,
                timestamp,
            });
            
            request_id
        }
        
        fn cancel_relay(ref self: ContractState, request_id: u64) {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            let request = self.relay_requests.read(request_id);
            assert(request.requester == caller, 'Not request owner');
            assert(!request.executed, 'Already executed');
            
            // Mark as executed to prevent future execution (effectively cancelled)
            let mut cancelled = request;
            cancelled.executed = true;
            self.relay_requests.write(request_id, cancelled);
            
            self.emit(RelayCancelled {
                requester: caller,
                request_id,
                timestamp,
            });
        }
        
        fn get_relay_request(self: @ContractState, request_id: u64) -> RelayRequest {
            self.relay_requests.read(request_id)
        }
        
        fn get_user_pending_relays(self: @ContractState, user: ContractAddress) -> Array<u64> {
            let count = self.user_pending_count.read(user);
            let mut pending = array![];
            
            let mut i: u64 = 0;
            loop {
                if i >= count {
                    break;
                }
                let request_id = self.user_pending_requests.read((user, i));
                let request = self.relay_requests.read(request_id);
                if !request.executed {
                    pending.append(request_id);
                }
                i += 1;
            };
            
            pending
        }
        
        fn execute_relay(ref self: ContractState, request_id: u64, proof_calldata: Span<felt252>) {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            // Verify caller is registered relayer
            assert(self.registered_relayers.read(caller), 'Not registered relayer');
            
            // Get request
            let request = self.relay_requests.read(request_id);
            assert(!request.executed, 'Already executed');
            
            // Check delay has passed
            let rep_registry = IReputationRegistryDispatcher {
                contract_address: self.reputation_registry.read()
            };
            let delay = rep_registry.get_relayer_delay(request.requester);
            assert(timestamp >= request.request_time + delay, 'Delay not passed');
            
            // Calculate fee
            let fee = (request.amount * request.fee_bps.into()) / 10000;
            let amount_after_fee = request.amount - fee;
            
            // Execute withdrawal through confidential transfer
            let ct = IConfidentialTransferDispatcher {
                contract_address: self.confidential_transfer.read()
            };
            ct.private_withdraw(
                request.nullifier,
                request.commitment,
                request.amount,
                proof_calldata,
                request.recipient
            );
            
            // Mark executed
            let mut executed = request;
            executed.executed = true;
            self.relay_requests.write(request_id, executed);
            
            // Update stats
            let total_volume = self.total_relayed_volume.read();
            self.total_relayed_volume.write(total_volume + request.amount);
            let total_fees = self.total_fees_collected.read();
            self.total_fees_collected.write(total_fees + fee);
            
            self.emit(RelayExecuted {
                relayer: caller,
                request_id,
                amount: amount_after_fee,
                fee,
                recipient: request.recipient,
                timestamp,
            });
        }
        
        fn can_execute_relay(self: @ContractState, request_id: u64) -> bool {
            let request = self.relay_requests.read(request_id);
            if request.executed {
                return false;
            }
            
            let rep_registry = IReputationRegistryDispatcher {
                contract_address: self.reputation_registry.read()
            };
            let delay = rep_registry.get_relayer_delay(request.requester);
            let timestamp = get_block_timestamp();
            
            timestamp >= request.request_time + delay
        }
        
        fn get_pending_count(self: @ContractState) -> u64 {
            let next_id = self.next_request_id.read();
            let mut pending: u64 = 0;
            
            let mut i: u64 = 1;
            loop {
                if i >= next_id {
                    break;
                }
                let request = self.relay_requests.read(i);
                if !request.executed {
                    pending += 1;
                }
                i += 1;
            };
            
            pending
        }
        
        fn get_relay_fee_bps(self: @ContractState, user: ContractAddress) -> u16 {
            // Tier 2 gets lower fees
            let rep_registry = IReputationRegistryDispatcher {
                contract_address: self.reputation_registry.read()
            };
            let delay = rep_registry.get_relayer_delay(user);
            
            // If delay is minimal (< 60 seconds), user is Tier 2
            if delay < 60 {
                self.tier2_fee_bps.read()
            } else {
                self.tier1_fee_bps.read()
            }
        }
        
        fn set_tier_fee(ref self: ContractState, tier: u8, fee_bps: u16) {
            let caller = get_caller_address();
            let admin = self.admin.read();
            assert(caller == admin, 'Only admin');
            
            if tier == 1 {
                self.tier1_fee_bps.write(fee_bps);
            } else if tier == 2 {
                self.tier2_fee_bps.write(fee_bps);
            }
        }
        
        fn register_relayer(ref self: ContractState) {
            let caller = get_caller_address();
            assert(!self.registered_relayers.read(caller), 'Already registered');
            
            self.registered_relayers.write(caller, true);
            self.relayer_count.write(self.relayer_count.read() + 1);
            
            self.emit(RelayerRegistered {
                relayer: caller,
                timestamp: get_block_timestamp(),
            });
        }
        
        fn unregister_relayer(ref self: ContractState) {
            let caller = get_caller_address();
            assert(self.registered_relayers.read(caller), 'Not registered');
            
            self.registered_relayers.write(caller, false);
            self.relayer_count.write(self.relayer_count.read() - 1);
            
            self.emit(RelayerUnregistered {
                relayer: caller,
                timestamp: get_block_timestamp(),
            });
        }
        
        fn is_relayer(self: @ContractState, address: ContractAddress) -> bool {
            self.registered_relayers.read(address)
        }
    }
}
