# Composable zkML Marketplace Architecture

## Vision: Models as Composable Tools

Users can **mix and match** privacy-preserving models to create custom agents.

```
┌─────────────────────────────────────────────────────┐
│         zkde.fi Agent Dashboard                     │
│                                                     │
│  User: "Create my custom agent"                    │
│                                                     │
│  Available Models (zkML Tools):                     │
│  ☑️ Credit Scoring (cross-chain)                    │
│  ☑️ Correlation Risk                                │
│  ☑️ TWAP Position                                   │
│  ☑️ Drawdown Resilience                             │
│  ☑️ Safety Diversification                          │
│  ☑️ Momentum Risk                                   │
│  ☐ Community Model: "MEV Protection" (by 0x123)   │
│  ☐ Community Model: "Whale Watch" (by 0xabc)      │
│                                                     │
│  → Compose → My Agent Configuration                 │
└─────────────────────────────────────────────────────┘
```

---

## Architecture: Multi-Processor zkML System

### Core Concept: Models = Processors

Each zkML model is a **processor** that:
- Takes inputs (portfolio state, market data)
- Generates a privacy-preserving proof
- Outputs a signal (risk score, tier, flag)
- Can be **composed** with other processors

```
┌──────────────────────────────────────────────────────────┐
│              MULTI-PROCESSOR ORCHESTRATOR                │
│                                                          │
│  User's Agent Configuration:                             │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐      │
│  │ Processor 1│──→│ Processor 2│──→│ Processor 3│      │
│  │  Credit    │   │Correlation │   │   TWAP     │      │
│  │  Scoring   │   │    Risk    │   │  Position  │      │
│  └────────────┘   └────────────┘   └────────────┘      │
│       ↓                 ↓                 ↓              │
│    AAA tier        Low corr          Stable cap         │
│       ↓                 ↓                 ↓              │
│  ┌─────────────────────────────────────────────┐        │
│  │       DECISION ENGINE                       │        │
│  │  "All signals pass → Aggressive strategy"  │        │
│  └─────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────┘
```

---

## System Architecture

### Layer 1: zkML Model Registry (On-Chain)

**Contract**: Model marketplace + verification

```cairo
// contracts/src/model_registry.cairo

#[starknet::contract]
mod ModelRegistry {
    use garaga::groth16_verifier_bn254;
    use garaga::risc0_verifier_bn254;
    
    #[derive(Drop, Serde, starknet::Store)]
    struct Model {
        model_id: felt252,
        creator: ContractAddress,
        name: ByteArray,
        model_type: ModelType,  // Groth16, RiscZero, etc.
        verifier: ContractAddress,
        input_schema: ByteArray,  // JSON schema
        output_schema: ByteArray,
        fee_bps: u16,  // Creator fee (e.g. 10 bps = 0.1%)
        is_active: bool,
    }
    
    #[derive(Drop, Serde, starknet::Store)]
    enum ModelType {
        Groth16BN254,
        RiscZero,
        SP1,
        Custom,
    }
    
    #[storage]
    struct Storage {
        models: LegacyMap<felt252, Model>,
        model_count: u64,
        user_models: LegacyMap<(ContractAddress, u64), felt252>,  // user → model_ids
    }
    
    #[external(v0)]
    fn register_model(
        ref self: ContractState,
        name: ByteArray,
        model_type: ModelType,
        verifier: ContractAddress,
        input_schema: ByteArray,
        output_schema: ByteArray,
        fee_bps: u16
    ) -> felt252 {
        let caller = get_caller_address();
        let model_id = self.model_count.read() + 1;
        
        let model = Model {
            model_id,
            creator: caller,
            name,
            model_type,
            verifier,
            input_schema,
            output_schema,
            fee_bps,
            is_active: true,
        };
        
        self.models.write(model_id, model);
        self.model_count.write(model_id);
        
        self.emit(ModelRegistered { model_id, creator: caller, name });
        
        model_id
    }
    
    #[external(v0)]
    fn execute_model(
        ref self: ContractState,
        model_id: felt252,
        proof: Span<felt252>,
        public_inputs: Span<felt252>
    ) -> Span<felt252> {
        let model = self.models.read(model_id);
        assert(model.is_active, 'Model not active');
        
        // Verify proof based on model type
        let is_valid = match model.model_type {
            ModelType::Groth16BN254 => groth16_verifier_bn254::verify(proof),
            ModelType::RiscZero => risc0_verifier_bn254::verify(proof),
            _ => false,
        };
        
        assert(is_valid, 'Invalid proof');
        
        // Pay creator fee
        self._pay_model_fee(model.creator, model.fee_bps);
        
        // Extract outputs from proof
        let outputs = self._extract_outputs(proof);
        
        self.emit(ModelExecuted { model_id, user: get_caller_address() });
        
        outputs
    }
}
```

---

### Layer 2: Agent Composer (Smart Contract)

**Contract**: Compose models into agents

```cairo
// contracts/src/agent_composer.cairo

#[starknet::contract]
mod AgentComposer {
    use super::ModelRegistry;
    
    #[derive(Drop, Serde, starknet::Store)]
    struct AgentConfig {
        agent_id: felt252,
        owner: ContractAddress,
        name: ByteArray,
        processors: Span<felt252>,  // Array of model_ids
        decision_logic: ByteArray,  // JSON: how to combine signals
        is_active: bool,
    }
    
    #[storage]
    struct Storage {
        agents: LegacyMap<felt252, AgentConfig>,
        agent_count: u64,
        model_registry: ContractAddress,
    }
    
    #[external(v0)]
    fn create_agent(
        ref self: ContractState,
        name: ByteArray,
        processors: Span<felt252>,  // [credit_model, correlation_model, twap_model]
        decision_logic: ByteArray    // JSON: {type: "AND", threshold: 0.7}
    ) -> felt252 {
        let caller = get_caller_address();
        let agent_id = self.agent_count.read() + 1;
        
        // Validate all processors exist
        let registry = IModelRegistryDispatcher {
            contract_address: self.model_registry.read()
        };
        
        for model_id in processors {
            let model = registry.get_model(*model_id);
            assert(model.is_active, 'Invalid model');
        }
        
        let agent = AgentConfig {
            agent_id,
            owner: caller,
            name,
            processors,
            decision_logic,
            is_active: true,
        };
        
        self.agents.write(agent_id, agent);
        self.agent_count.write(agent_id);
        
        self.emit(AgentCreated { agent_id, owner: caller, name });
        
        agent_id
    }
    
    #[external(v0)]
    fn execute_agent(
        ref self: ContractState,
        agent_id: felt252,
        proofs: Span<Span<felt252>>,  // Array of proofs (one per processor)
        inputs: Span<Span<felt252>>   // Array of inputs
    ) -> bool {
        let agent = self.agents.read(agent_id);
        assert(agent.is_active, 'Agent not active');
        assert(proofs.len() == agent.processors.len(), 'Proof count mismatch');
        
        let registry = IModelRegistryDispatcher {
            contract_address: self.model_registry.read()
        };
        
        // Execute all processors
        let mut signals: Array<Span<felt252>> = ArrayTrait::new();
        
        for i in 0..agent.processors.len() {
            let model_id = *agent.processors.at(i);
            let proof = *proofs.at(i);
            let input = *inputs.at(i);
            
            let output = registry.execute_model(model_id, proof, input);
            signals.append(output);
        }
        
        // Combine signals based on decision logic
        let should_execute = self._evaluate_decision_logic(
            agent.decision_logic,
            signals.span()
        );
        
        self.emit(AgentExecuted { agent_id, result: should_execute });
        
        should_execute
    }
    
    fn _evaluate_decision_logic(
        self: @ContractState,
        logic: ByteArray,
        signals: Span<Span<felt252>>
    ) -> bool {
        // Parse decision logic JSON
        // Example: {"type": "AND"} → all signals must pass
        //          {"type": "OR"} → any signal can pass
        //          {"type": "WEIGHTED", "weights": [0.4, 0.3, 0.3], "threshold": 0.7}
        
        // Simple AND logic for now
        let mut all_pass = true;
        for signal in signals {
            // Assume signal[0] is boolean pass/fail
            if *signal.at(0) == 0 {
                all_pass = false;
                break;
            }
        }
        
        all_pass
    }
}
```

---

### Layer 3: Multi-Processor Backend

**Backend service**: Coordinates model execution

```python
# backend/app/services/multi_processor.py

from typing import List, Dict, Any
from dataclasses import dataclass

@dataclass
class Processor:
    """A zkML model that can be composed"""
    id: str
    name: str
    type: str  # "groth16", "risc_zero", "sp1"
    input_schema: Dict
    output_schema: Dict
    generate_proof: callable
    fee_bps: int
    creator: str

class MultiProcessorOrchestrator:
    """
    Orchestrates execution of composed zkML models.
    
    Each processor:
    1. Takes inputs (portfolio, market data)
    2. Generates a privacy-preserving proof
    3. Outputs a signal
    
    Agent configuration defines how to combine signals.
    """
    
    def __init__(self):
        self.processors: Dict[str, Processor] = {}
        self._load_builtin_processors()
    
    def _load_builtin_processors(self):
        """Load zkde.fi built-in processors"""
        
        # Processor 1: Credit Scoring (RISC Zero)
        self.processors['credit_scoring'] = Processor(
            id='credit_scoring',
            name='Cross-Chain Credit Scoring',
            type='risc_zero',
            input_schema={
                'ethereum_address': 'string',
                'starknet_address': 'string',
                'identity_commitment': 'felt252'
            },
            output_schema={
                'credit_tier': 'enum[AAA, AA, A, B]',
                'commitment': 'felt252'
            },
            generate_proof=self._generate_credit_proof,
            fee_bps=0,  # Built-in, no fee
            creator='zkde.fi'
        )
        
        # Processor 2: Correlation Risk (Groth16)
        self.processors['correlation_risk'] = Processor(
            id='correlation_risk',
            name='Portfolio Correlation Risk',
            type='groth16',
            input_schema={
                'positions': 'array[{asset, weight}]',
                'price_history': 'array[array[float]]'
            },
            output_schema={
                'correlation_risk': 'float',
                'below_threshold': 'bool'
            },
            generate_proof=self._generate_correlation_proof,
            fee_bps=0,
            creator='zkde.fi'
        )
        
        # Processor 3: TWAP Position (Groth16)
        self.processors['twap_position'] = Processor(
            id='twap_position',
            name='Time-Weighted Average Position',
            type='groth16',
            input_schema={
                'position_history': 'array[{timestamp, amount}]',
                'window_days': 'int'
            },
            output_schema={
                'twap': 'float',
                'below_threshold': 'bool'
            },
            generate_proof=self._generate_twap_proof,
            fee_bps=0,
            creator='zkde.fi'
        )
        
        # Processor 4: Safety Diversification (Groth16)
        self.processors['safety_diversification'] = Processor(
            id='safety_diversification',
            name='Safety-Weighted Diversification',
            type='groth16',
            input_schema={
                'positions': 'array[{protocol, value}]',
                'safety_scores': 'dict[protocol, score]'
            },
            output_schema={
                'diversification_score': 'float',
                'is_diversified': 'bool'
            },
            generate_proof=self._generate_diversification_proof,
            fee_bps=0,
            creator='zkde.fi'
        )
        
        # More processors...
    
    async def execute_agent(
        self,
        agent_config: Dict[str, Any],
        user_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Execute a composed agent.
        
        agent_config = {
            'processors': ['credit_scoring', 'correlation_risk', 'twap_position'],
            'decision_logic': {
                'type': 'AND',  # All must pass
                'thresholds': {
                    'credit_scoring': {'min_tier': 'AA'},
                    'correlation_risk': {'max_risk': 0.7},
                    'twap_position': {'max_twap': 100000}
                }
            }
        }
        """
        
        # Execute each processor
        processor_results = []
        proofs = []
        
        for processor_id in agent_config['processors']:
            processor = self.processors[processor_id]
            
            # Extract relevant inputs for this processor
            inputs = self._extract_processor_inputs(
                processor,
                user_data
            )
            
            # Generate proof
            proof_result = await processor.generate_proof(inputs)
            
            processor_results.append({
                'processor_id': processor_id,
                'output': proof_result['output'],
                'proof': proof_result['proof']
            })
            
            proofs.append(proof_result['proof'])
        
        # Combine signals based on decision logic
        decision = self._evaluate_decision_logic(
            agent_config['decision_logic'],
            processor_results
        )
        
        return {
            'should_execute': decision['should_execute'],
            'reason': decision['reason'],
            'processor_results': processor_results,
            'proofs': proofs,
            'on_chain_calldata': self._format_for_on_chain(
                agent_config,
                proofs,
                processor_results
            )
        }
    
    def _evaluate_decision_logic(
        self,
        logic: Dict[str, Any],
        results: List[Dict]
    ) -> Dict[str, Any]:
        """
        Evaluate decision logic to combine processor signals.
        
        Logic types:
        - AND: All processors must pass
        - OR: Any processor can pass
        - WEIGHTED: Weighted average of scores
        - CUSTOM: User-defined function
        """
        
        if logic['type'] == 'AND':
            # All must pass
            for result in results:
                processor_id = result['processor_id']
                threshold = logic['thresholds'].get(processor_id, {})
                
                if not self._check_threshold(result['output'], threshold):
                    return {
                        'should_execute': False,
                        'reason': f"{processor_id} failed threshold"
                    }
            
            return {
                'should_execute': True,
                'reason': 'All processors passed'
            }
        
        elif logic['type'] == 'OR':
            # Any can pass
            for result in results:
                processor_id = result['processor_id']
                threshold = logic['thresholds'].get(processor_id, {})
                
                if self._check_threshold(result['output'], threshold):
                    return {
                        'should_execute': True,
                        'reason': f"{processor_id} passed"
                    }
            
            return {
                'should_execute': False,
                'reason': 'No processor passed'
            }
        
        elif logic['type'] == 'WEIGHTED':
            # Weighted average
            weights = logic['weights']
            threshold = logic['threshold']
            
            total_score = 0
            for i, result in enumerate(results):
                score = self._normalize_score(result['output'])
                total_score += score * weights[i]
            
            return {
                'should_execute': total_score >= threshold,
                'reason': f"Weighted score: {total_score:.2f}"
            }
        
        else:
            raise ValueError(f"Unknown logic type: {logic['type']}")
    
    def _check_threshold(
        self,
        output: Dict[str, Any],
        threshold: Dict[str, Any]
    ) -> bool:
        """Check if output meets threshold"""
        
        for key, value in threshold.items():
            if key.startswith('min_'):
                field = key[4:]  # Remove 'min_' prefix
                if output.get(field, 0) < value:
                    return False
            
            elif key.startswith('max_'):
                field = key[4:]  # Remove 'max_' prefix
                if output.get(field, float('inf')) > value:
                    return False
        
        return True
    
    async def _generate_credit_proof(self, inputs: Dict) -> Dict:
        """Generate RISC Zero credit scoring proof"""
        from app.services.credit_scoring_service import CreditScoringService
        
        service = CreditScoringService()
        return await service.generate_proof(
            identity_commitment=inputs['identity_commitment'],
            ethereum_address=inputs['ethereum_address'],
            starknet_address=inputs['starknet_address']
        )
    
    async def _generate_correlation_proof(self, inputs: Dict) -> Dict:
        """Generate Groth16 correlation risk proof"""
        from app.services.zkml_correlation_service import CorrelationService
        
        service = CorrelationService()
        return await service.generate_proof(
            positions=inputs['positions'],
            price_history=inputs['price_history']
        )
    
    # More proof generators...


# Singleton instance
orchestrator = MultiProcessorOrchestrator()


def get_orchestrator() -> MultiProcessorOrchestrator:
    return orchestrator
```

---

### Layer 4: Frontend Agent Dashboard

**Component**: User interface for composing agents

```typescript
// frontend/src/components/zkdefi/AgentComposer.tsx

import { useState } from 'react';
import { useAccount } from '@starknet-react/core';

interface Processor {
  id: string;
  name: string;
  description: string;
  type: 'groth16' | 'risc_zero' | 'sp1';
  inputSchema: any;
  outputSchema: any;
  fee: string;  // "0 bps" or "10 bps"
  creator: string;
}

interface AgentConfig {
  name: string;
  processors: string[];
  decisionLogic: {
    type: 'AND' | 'OR' | 'WEIGHTED';
    thresholds?: Record<string, any>;
    weights?: number[];
    threshold?: number;
  };
}

export function AgentComposer() {
  const { address } = useAccount();
  
  const [availableProcessors, setAvailableProcessors] = useState<Processor[]>([
    {
      id: 'credit_scoring',
      name: 'Cross-Chain Credit Scoring',
      description: 'Proves credit tier based on cross-chain activity (private)',
      type: 'risc_zero',
      inputSchema: { /* ... */ },
      outputSchema: { credit_tier: 'AAA|AA|A|B' },
      fee: '0 bps',
      creator: 'zkde.fi'
    },
    {
      id: 'correlation_risk',
      name: 'Portfolio Correlation Risk',
      description: 'Proves portfolio correlation is below threshold',
      type: 'groth16',
      inputSchema: { /* ... */ },
      outputSchema: { correlation_risk: 'number', below_threshold: 'bool' },
      fee: '0 bps',
      creator: 'zkde.fi'
    },
    {
      id: 'twap_position',
      name: 'TWAP Position Proof',
      description: 'Proves time-weighted average position over N days',
      type: 'groth16',
      inputSchema: { /* ... */ },
      outputSchema: { twap: 'number', below_threshold: 'bool' },
      fee: '0 bps',
      creator: 'zkde.fi'
    },
    // Community processors
    {
      id: 'mev_protection',
      name: 'MEV Protection Score',
      description: 'Predicts MEV risk for trade routes',
      type: 'risc_zero',
      inputSchema: { /* ... */ },
      outputSchema: { risk_score: 'number', safe_route: 'number' },
      fee: '5 bps',
      creator: '0x123abc...'
    }
  ]);
  
  const [agentConfig, setAgentConfig] = useState<AgentConfig>({
    name: '',
    processors: [],
    decisionLogic: { type: 'AND' }
  });
  
  const [showComposer, setShowComposer] = useState(false);
  
  const handleAddProcessor = (processorId: string) => {
    setAgentConfig(prev => ({
      ...prev,
      processors: [...prev.processors, processorId]
    }));
  };
  
  const handleRemoveProcessor = (processorId: string) => {
    setAgentConfig(prev => ({
      ...prev,
      processors: prev.processors.filter(id => id !== processorId)
    }));
  };
  
  const handleCreateAgent = async () => {
    // Call backend to create agent configuration
    const response = await fetch(`${API_BASE}/api/v1/zkdefi/agents/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_address: address,
        agent_config: agentConfig
      })
    });
    
    const data = await response.json();
    
    // Submit to on-chain AgentComposer contract
    await agentComposerContract.create_agent(
      agentConfig.name,
      agentConfig.processors,
      JSON.stringify(agentConfig.decisionLogic)
    );
    
    toastSuccess(`Agent "${agentConfig.name}" created!`);
  };
  
  return (
    <div className="agent-composer">
      <h2>Compose Your Agent</h2>
      
      {/* Available Processors */}
      <div className="processor-library">
        <h3>Available Models (zkML Processors)</h3>
        
        <div className="processor-grid">
          {availableProcessors.map(processor => (
            <ProcessorCard
              key={processor.id}
              processor={processor}
              isSelected={agentConfig.processors.includes(processor.id)}
              onAdd={() => handleAddProcessor(processor.id)}
              onRemove={() => handleRemoveProcessor(processor.id)}
            />
          ))}
        </div>
      </div>
      
      {/* Agent Configuration */}
      <div className="agent-config">
        <h3>Your Agent Configuration</h3>
        
        <input
          type="text"
          placeholder="Agent name (e.g., 'Conservative Yield Hunter')"
          value={agentConfig.name}
          onChange={(e) => setAgentConfig(prev => ({ ...prev, name: e.target.value }))}
        />
        
        <div className="selected-processors">
          <h4>Selected Processors ({agentConfig.processors.length})</h4>
          {agentConfig.processors.map((id, index) => {
            const processor = availableProcessors.find(p => p.id === id);
            return (
              <div key={id} className="processor-item">
                {index + 1}. {processor?.name}
                <button onClick={() => handleRemoveProcessor(id)}>Remove</button>
              </div>
            );
          })}
        </div>
        
        {/* Decision Logic */}
        <div className="decision-logic">
          <h4>How should processors combine?</h4>
          
          <select
            value={agentConfig.decisionLogic.type}
            onChange={(e) => setAgentConfig(prev => ({
              ...prev,
              decisionLogic: { type: e.target.value as any }
            }))}
          >
            <option value="AND">AND (all must pass)</option>
            <option value="OR">OR (any can pass)</option>
            <option value="WEIGHTED">WEIGHTED (custom weights)</option>
          </select>
          
          {agentConfig.decisionLogic.type === 'WEIGHTED' && (
            <WeightedLogicConfig
              processors={agentConfig.processors}
              onChange={(weights, threshold) => {
                setAgentConfig(prev => ({
                  ...prev,
                  decisionLogic: {
                    type: 'WEIGHTED',
                    weights,
                    threshold
                  }
                }));
              }}
            />
          )}
        </div>
        
        <button
          onClick={handleCreateAgent}
          disabled={!agentConfig.name || agentConfig.processors.length === 0}
        >
          Create Agent
        </button>
      </div>
      
      {/* Preview */}
      <div className="agent-preview">
        <h3>Agent Preview</h3>
        <AgentFlowVisualization config={agentConfig} />
      </div>
    </div>
  );
}

function ProcessorCard({ processor, isSelected, onAdd, onRemove }) {
  return (
    <div className={`processor-card ${isSelected ? 'selected' : ''}`}>
      <h4>{processor.name}</h4>
      <p>{processor.description}</p>
      
      <div className="processor-meta">
        <span className="type">{processor.type.toUpperCase()}</span>
        <span className="fee">{processor.fee}</span>
        <span className="creator">by {processor.creator}</span>
      </div>
      
      {isSelected ? (
        <button onClick={onRemove}>Remove</button>
      ) : (
        <button onClick={onAdd}>Add to Agent</button>
      )}
    </div>
  );
}

function AgentFlowVisualization({ config }) {
  return (
    <div className="flow-viz">
      {config.processors.map((id, index) => (
        <div key={id} className="flow-node">
          <div className="processor-box">
            {id}
          </div>
          {index < config.processors.length - 1 && (
            <div className="connector">
              {config.decisionLogic.type === 'AND' ? '&&' : 
               config.decisionLogic.type === 'OR' ? '||' : 
               `(${config.decisionLogic.weights?.[index] || 0.33})`}
            </div>
          )}
        </div>
      ))}
      
      <div className="decision-output">
        → Execute Agent: {config.decisionLogic.type}
      </div>
    </div>
  );
}
```

---

## Marketplace Features

### 1. Model Discovery

```typescript
// Users can browse and search models
GET /api/v1/zkdefi/marketplace/models
{
  filters: {
    type: 'risc_zero',
    creator: '0x123...',
    min_rating: 4.5,
    category: 'risk_assessment'
  }
}
```

### 2. Model Publishing

```typescript
// Creators publish models
POST /api/v1/zkdefi/marketplace/publish
{
  name: "Whale Watch Alert",
  description: "Detects whale movements that might impact price",
  type: "risc_zero",
  circuit_hash: "0xabc...",
  verifier_address: "0x123...",
  fee_bps: 5,  // 0.05% per usage
  input_schema: {...},
  output_schema: {...}
}
```

### 3. Revenue Sharing

```cairo
// On-chain revenue distribution
#[external(v0)]
fn execute_model(model_id: felt252, proof: Span<felt252>) {
    // ...verify proof...
    
    // Pay creator
    let model = self.models.read(model_id);
    let fee = execution_cost * model.fee_bps / 10000;
    
    erc20.transfer(model.creator, fee);
    
    self.emit(ModelFeeCollected { model_id, creator: model.creator, fee });
}
```

---

## Example: User Creates Custom Agent

```
User: "I want a conservative agent"

Step 1: Select processors
✅ Credit Scoring (must be AA+)
✅ Correlation Risk (max 0.6)
✅ TWAP Position (stable capital)
✅ Safety Diversification (3+ protocols)

Step 2: Configure logic
Decision: AND (all must pass)

Step 3: Create agent
Agent Name: "Conservative Yield Hunter"
Processors: [credit, correlation, twap, safety]
Logic: AND

Step 4: Deploy on-chain
→ AgentComposer.create_agent(...)
→ Agent ID: 42

Step 5: Agent executes
When user clicks "Rebalance":
1. Backend generates 4 proofs (one per processor)
2. Submits all proofs on-chain
3. AgentComposer evaluates: all pass? → Execute!
4. ProofGatedYieldAgent executes rebalance
```

---

## Marketplace Economics

### Fee Structure

| Party | Fee | When |
|-------|-----|------|
| **Model Creator** | 0-50 bps per usage | User executes model |
| **zkde.fi Platform** | 10 bps per execution | Every agent execution |
| **Gas Cost** | ~$0.02-0.03 per model | On-chain verification |

### Example Revenue

```
Community Model: "MEV Protection" (5 bps fee)
↓
100 users × 4 executions/week × 52 weeks = 20,800 executions
↓
Avg execution value: $10,000
↓
Creator revenue: $10,000 × 20,800 × 0.0005 = $104,000/year
```

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-3)
- ✅ Build 3-4 simple Groth16 processors
- ✅ Multi-processor orchestrator backend
- ✅ Basic agent composer UI

### Phase 2: On-Chain (Weeks 4-6)
- ✅ ModelRegistry contract
- ✅ AgentComposer contract
- ✅ Integration with ProofGatedYieldAgent

### Phase 3: Identity (Weeks 7-8)
- ✅ Universal identity system
- ✅ Cross-chain aggregation
- ✅ RISC Zero credit scoring

### Phase 4: Marketplace (Weeks 9-12)
- ✅ Model publishing flow
- ✅ Revenue sharing
- ✅ Discovery & ratings
- ✅ Community models

---

## Summary

**What we're building**:
- 🎯 **Composable zkML**: Models as building blocks
- 🎯 **Multi-processor agents**: Users mix & match
- 🎯 **Marketplace**: Creators publish & earn
- 🎯 **Privacy-preserving**: All proofs private
- 🎯 **On-chain verification**: Trustless execution

**User experience**:
```
1. Browse model marketplace
2. Select 3-4 models
3. Configure decision logic
4. Deploy agent on-chain
5. Agent auto-executes with composed proofs
```

**Creator experience**:
```
1. Build zkML model (Groth16/RISC Zero)
2. Publish to marketplace
3. Set usage fee (0-50 bps)
4. Earn passive income as users compose with your model
```

Ready to start building? Which phase first?
