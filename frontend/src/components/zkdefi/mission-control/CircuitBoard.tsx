"use client";

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type NodeChange,
  type EdgeChange,
  Handle,
  Position,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  ChevronDown,
  ChevronRight,
  X,
  Play,
  Save,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { toastSuccess, toastError, toastInfo, toastWarning } from "@/lib/toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CircuitBoardProps {
  address: string | undefined;
  onClose: () => void;
}

interface PolicyResponse {
  address: string;
  policy: Record<string, unknown> & {
    circuit_board?: { nodes: Node[]; edges: Edge[]; policy_name?: string };
  };
  policy_hash?: string;
}

// ---------------------------------------------------------------------------
// Custom Node Components
// ---------------------------------------------------------------------------

function EntityNode({ data }: { data: Record<string, unknown> }) {
  const entityType = (data.entityType as string) || "Wallet";
  const properties = (data.properties as string[]) || [];
  return (
    <div className="min-w-[140px] rounded-lg border-2 border-cyan-500/70 bg-zinc-900/95 px-3 py-2 shadow-lg">
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-cyan-400" />
      <div className="text-xs font-semibold text-cyan-400">{entityType}</div>
      {properties.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[10px] text-zinc-400">
          {properties.map((p, i) => (
            <li key={i}>• {p}</li>
          ))}
        </ul>
      )}
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-cyan-400" />
    </div>
  );
}

function CircuitNode({ data }: { data: Record<string, unknown> }) {
  const name = (data.label as string) || "RiskScore";
  const outputType = (data.outputType as string) || "float";
  const threshold = (data.threshold as number) ?? 0.5;
  return (
    <div className="min-w-[140px] rounded-lg border-2 border-emerald-500/70 bg-zinc-900/95 px-3 py-2 shadow-lg">
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-emerald-400" />
      <div className="text-xs font-semibold text-emerald-400">{name}</div>
      <div className="text-[10px] text-zinc-500">→ {outputType}</div>
      <div className="text-[10px] text-zinc-500 mt-0.5">threshold: {threshold.toFixed(2)}</div>
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-emerald-400" />
    </div>
  );
}

function LogicNode({ data }: { data: Record<string, unknown> }) {
  const logicType = (data.logicType as string) || "IF/ELSE";
  const threshold = (data.threshold as number) ?? 0.5;
  const portCount = (data.portCount as number) ?? 2;
  const percentages = (data.percentages as number[]) || [50, 50];
  return (
    <div className="min-w-[140px] rounded-lg border-2 border-amber-500/70 bg-zinc-900/95 px-3 py-2 shadow-lg">
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-amber-400" />
      <div className="text-xs font-semibold text-amber-400">{logicType}</div>
      {logicType === "IF/ELSE" && (
        <div className="text-[10px] text-zinc-500 mt-0.5">threshold: {threshold}</div>
      )}
      {(logicType === "AND" || logicType === "OR") && (
        <div className="text-[10px] text-zinc-500 mt-0.5">ports: {portCount}</div>
      )}
      {logicType === "SPLIT" && (
        <div className="text-[10px] text-zinc-500 mt-0.5">
          {percentages.join("% / ")}%
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-amber-400" />
    </div>
  );
}

function VenueNode({ data }: { data: Record<string, unknown> }) {
  const name = (data.label as string) || "Ekubo LP";
  const allocation = (data.allocation as number) ?? 100;
  return (
    <div className="min-w-[140px] rounded-lg border-2 border-violet-500/70 bg-zinc-900/95 px-3 py-2 shadow-lg">
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-violet-400" />
      <div className="text-xs font-semibold text-violet-400">{name}</div>
      <div className="text-[10px] text-zinc-500 mt-0.5">{allocation}%</div>
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-violet-400" />
    </div>
  );
}

function ModelNode({ data }: { data: Record<string, unknown> }) {
  const name = (data.label as string) || "ML Model";
  const threshold = (data.threshold as number) ?? 30;
  const confidence = (data.confidence as number) ?? 0.8;
  return (
    <div className="min-w-[140px] rounded-lg border-2 border-indigo-500/70 bg-zinc-900/95 px-3 py-2 shadow-lg">
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-indigo-400" />
      <div className="text-xs font-semibold text-indigo-400">{name}</div>
      <div className="text-[10px] text-zinc-500">thresh: {threshold}</div>
      <div className="text-[10px] text-zinc-500">conf: {(confidence * 100).toFixed(0)}%</div>
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-indigo-400" />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  entity: EntityNode,
  circuit: CircuitNode,
  logic: LogicNode,
  venue: VenueNode,
  model: ModelNode,
};

// ---------------------------------------------------------------------------
// Palette Item (draggable)
// ---------------------------------------------------------------------------

function PaletteItem({
  label,
  type,
  onDragStart,
}: {
  label: string;
  type: string;
  onDragStart: (e: React.DragEvent, nodeType: string, nodeData: Record<string, unknown>) => void;
}) {
  const data: Record<string, unknown> = { label };
  if (type === "entity") data.entityType = label;
  if (type === "circuit") data.outputType = "float";
  if (type === "logic") {
    data.logicType = label;
    if (label === "SPLIT") data.percentages = [50, 50];
    if (label === "IF/ELSE") data.threshold = 0.5;
  }
  if (type === "venue") data.allocation = 100;
  if (type === "model") {
    data.threshold = 30;
    data.confidence = 0.8;
  }
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, type, data)}
      className="cursor-grab rounded border border-zinc-600 bg-zinc-800/80 px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700/80 active:cursor-grabbing"
    >
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function CollapsibleSection({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  return (
    <div className="border-b border-zinc-800">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 py-2 text-left text-xs font-medium text-zinc-300 hover:text-zinc-100"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {title}
      </button>
      {open && <div className="pb-2 space-y-1">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flow Canvas (inner component with useReactFlow)
// ---------------------------------------------------------------------------

let nodeId = 0;
function getId() {
  return `node_${++nodeId}`;
}

function FlowCanvasInner({
  nodes,
  setNodes,
  onNodesChange,
  edges,
  setEdges,
  onEdgesChange,
  onConnect,
  onNodeDragStart,
  selectedNode,
  onSelectNode,
}: {
  nodes: Node[];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  onNodesChange: (changes: NodeChange[]) => void;
  edges: Edge[];
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (conn: Connection) => void;
  onNodeDragStart: (e: React.DragEvent, nodeType: string, nodeData: Record<string, unknown>) => void;
  selectedNode: Node | null;
  onSelectNode: (n: Node | null) => void;
}) {
  const { screenToFlowPosition } = useReactFlow();

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("application/reactflow");
      const dataJson = e.dataTransfer.getData("application/reactflow-data");
      if (!type) return;
      const data = dataJson ? (JSON.parse(dataJson) as Record<string, unknown>) : {};
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const id = getId();
      const newNode: Node = {
        id,
        type: type as "entity" | "circuit" | "logic" | "venue" | "model",
        position,
        data: { label: (data.label as string) || type, ...data },
      };
      setNodes((nds) => nds.concat(newNode));
    },
    [screenToFlowPosition, setNodes]
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onSelectNode(node);
    },
    [onSelectNode]
  );

  const handlePaneClick = useCallback(() => {
    onSelectNode(null);
  }, [onSelectNode]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onNodeClick={handleNodeClick}
      onPaneClick={handlePaneClick}
      nodeTypes={nodeTypes}
      fitView
      className="bg-zinc-950"
      defaultEdgeOptions={{
        type: "smoothstep",
        animated: true,
        style: { stroke: "rgb(113 113 122)" },
      }}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="rgb(63 63 70)" />
      <Controls className="!bg-zinc-800 !border-zinc-700 !rounded" />
      <MiniMap
        nodeColor={(n) => {
          if (n.type === "entity") return "rgb(34 211 238)";
          if (n.type === "circuit") return "rgb(52 211 153)";
          if (n.type === "logic") return "rgb(245 158 11)";
          if (n.type === "venue") return "rgb(139 92 246)";
          if (n.type === "model") return "rgb(129 140 248)";
          return "rgb(113 113 122)";
        }}
        maskColor="rgba(0,0,0,0.7)"
        className="!bg-zinc-900 !border-zinc-700"
      />
    </ReactFlow>
  );
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const TEMPLATES = {
  "Conservative Yield": {
    nodes: [
      { id: "n1", type: "entity", position: { x: 50, y: 100 }, data: { label: "Wallet", entityType: "Wallet", properties: [] } },
      { id: "n2", type: "circuit", position: { x: 250, y: 100 }, data: { label: "RiskScore", outputType: "float", threshold: 0.3 } },
      { id: "n3", type: "logic", position: { x: 450, y: 80 }, data: { label: "IF/ELSE", logicType: "IF/ELSE", threshold: 0.3 } },
      { id: "n4", type: "logic", position: { x: 650, y: 60 }, data: { label: "SPLIT", logicType: "SPLIT", percentages: [35, 20, 15] } },
      { id: "n5", type: "venue", position: { x: 850, y: 20 }, data: { label: "Ekubo LP", allocation: 35 } },
      { id: "n6", type: "venue", position: { x: 850, y: 80 }, data: { label: "Lending", allocation: 20 } },
      { id: "n7", type: "venue", position: { x: 850, y: 140 }, data: { label: "Staking", allocation: 15 } },
    ] as Node[],
    edges: [
      { id: "e1", source: "n1", target: "n2" },
      { id: "e2", source: "n2", target: "n3" },
      { id: "e3", source: "n3", target: "n4" },
      { id: "e4", source: "n4", target: "n5" },
      { id: "e5", source: "n4", target: "n6" },
      { id: "e6", source: "n4", target: "n7" },
    ] as Edge[],
  },
  "Balanced Growth": {
    nodes: [
      { id: "n1", type: "entity", position: { x: 50, y: 100 }, data: { label: "Wallet", entityType: "Wallet" } },
      { id: "n2", type: "circuit", position: { x: 250, y: 100 }, data: { label: "RiskScore", outputType: "float", threshold: 0.5 } },
      { id: "n3", type: "logic", position: { x: 450, y: 100 }, data: { label: "IF/ELSE", logicType: "IF/ELSE", threshold: 0.5 } },
      { id: "n4", type: "venue", position: { x: 650, y: 100 }, data: { label: "Ekubo LP", allocation: 100 } },
    ] as Node[],
    edges: [
      { id: "e1", source: "n1", target: "n2" },
      { id: "e2", source: "n2", target: "n3" },
      { id: "e3", source: "n3", target: "n4" },
    ] as Edge[],
  },
  "Privacy Sovereign": {
    nodes: [
      { id: "n1", type: "entity", position: { x: 50, y: 100 }, data: { label: "Wallet", entityType: "Wallet" } },
      { id: "n2", type: "venue", position: { x: 300, y: 100 }, data: { label: "Dark Ledger", allocation: 100 } },
    ] as Node[],
    edges: [{ id: "e1", source: "n1", target: "n2" }] as Edge[],
  },
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function CircuitBoard({ address, onClose }: CircuitBoardProps) {
  const [policyName, setPolicyName] = useState<string>("Untitled Policy");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onNodeDragStart = useCallback((e: React.DragEvent, nodeType: string, nodeData: Record<string, unknown>) => {
    e.dataTransfer.setData("application/reactflow", nodeType);
    e.dataTransfer.setData("application/reactflow-data", JSON.stringify(nodeData));
    e.dataTransfer.effectAllowed = "move";
  }, []);

  // Load policy on mount
  useEffect(() => {
    if (!address) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    apiFetch<PolicyResponse>(`/api/v1/zkdefi/mc/policy/${address}`)
      .then((res) => {
        if (cancelled) return;
        const cb = res?.policy?.circuit_board;
        if (cb?.nodes?.length) {
          nodeId = Math.max(0, ...cb.nodes.map((n) => parseInt(n.id.replace(/\D/g, ""), 10) || 0));
          setNodes(cb.nodes);
          setEdges(cb.edges || []);
        }
        if (cb?.policy_name) setPolicyName(cb.policy_name);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [address, setNodes, setEdges]);

  // Load available models
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ models: Array<{ id: string; name: string }> }>("/api/v1/agents/models/list")
      .then((res) => {
        if (!cancelled && res?.models) {
          setModels(res.models);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          toastWarning(`Failed to load models: ${e instanceof Error ? e.message : "Unknown error"}`);
          setModels([]);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const handleTestRun = useCallback(() => {
    const sourceNodes = new Set(edges.map((e) => e.source));
    const targetNodes = new Set(edges.map((e) => e.target));
    const roots = nodes.filter((n) => !targetNodes.has(n.id));
    const leaves = nodes.filter((n) => !sourceNodes.has(n.id));
    const venueLeaves = leaves.filter((n) => n.type === "venue");
    const disconnected = nodes.filter((n) => !sourceNodes.has(n.id) && !targetNodes.has(n.id) && nodes.length > 1);
    if (disconnected.length > 0) {
      toastWarning(`Validation: ${disconnected.length} disconnected node(s)`);
      return;
    }
    if (venueLeaves.length === 0 && leaves.length > 0) {
      toastWarning("Validation: No venue outputs connected");
      return;
    }
    toastSuccess("Validation passed: all outputs connected");
  }, [nodes, edges]);

  const handleSave = useCallback(async () => {
    if (!address) {
      toastError("Connect wallet to save");
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/v1/zkdefi/mc/policy/${address}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patch: {
            circuit_board: {
              nodes,
              edges,
              policy_name: policyName,
            },
          },
        }),
      });
      toastSuccess("Policy saved");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [address, nodes, edges, policyName]);

  const handleSaveAsAgent = useCallback(async () => {
    if (!address) {
      toastError("Connect wallet first");
      return;
    }
    if (nodes.length === 0) {
      toastWarning("Add nodes to the canvas first");
      return;
    }
    try {
      const modelNodes = nodes.filter((n) => n.type === "model");
      const processorIds = modelNodes.map(
        (n) => ((n.data as Record<string, unknown>)?.label as string)?.toLowerCase().replace(/\s+/g, "_") || "risk_scoring"
      );
      await apiFetch("/api/v1/agents/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          name: policyName,
          processors: processorIds.length ? processorIds : ["risk_score"],
          decision_logic: { type: "AND" },
        }),
      });
      toastSuccess(`Agent "${policyName}" created`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Failed to create agent");
    }
  }, [address, nodes, edges, policyName]);

  const handleTemplateSelect = useCallback((key: string) => {
    const t = TEMPLATES[key as keyof typeof TEMPLATES];
    if (t) {
      nodeId = Math.max(0, ...t.nodes.map((n) => parseInt(n.id.replace(/\D/g, ""), 10) || 0));
      setNodes(t.nodes);
      setEdges(t.edges);
      setPolicyName(key);
      toastInfo(`Loaded template: ${key}`);
    }
  }, [setNodes, setEdges]);

  const updateSelectedNodeData = useCallback((key: string, value: unknown) => {
    if (!selectedNode) return;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedNode.id ? { ...n, data: { ...n.data, [key]: value } } : n
      )
    );
    setSelectedNode((prev) =>
      prev ? { ...prev, data: { ...prev.data, [key]: value } } : null
    );
  }, [selectedNode, setNodes]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950">
        <div className="text-zinc-400">Loading policy…</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex h-10 flex-shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-4">
        <div className="flex items-center gap-4">
          <span className="font-semibold text-sm">Circuit Board</span>
          <span className="text-zinc-500">|</span>
          <input
            type="text"
            value={policyName}
            onChange={(e) => setPolicyName(e.target.value)}
            className="w-48 rounded border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200 placeholder-zinc-500"
            placeholder="Policy name"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            onChange={(e) => handleTemplateSelect(e.target.value)}
            className="rounded border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200"
          >
            <option value="">Templates</option>
            {Object.keys(TEMPLATES).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <button
            onClick={handleTestRun}
            className="flex items-center gap-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-xs hover:bg-zinc-700"
          >
            <Play className="w-3 h-3" /> Test Run
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 rounded border border-emerald-600 bg-emerald-600/20 px-2 py-0.5 text-xs text-emerald-400 hover:bg-emerald-600/30 disabled:opacity-50"
          >
            <Save className="w-3 h-3" /> Save
          </button>
          <button
            onClick={handleSaveAsAgent}
            className="flex items-center gap-1 rounded border border-indigo-600 bg-indigo-600/20 px-2 py-0.5 text-xs text-indigo-400 hover:bg-indigo-600/30"
          >
            <Save className="w-3 h-3" /> Save As Agent
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-xs hover:bg-zinc-700"
          >
            <X className="w-3 h-3" /> Close
          </button>
        </div>
      </header>

      {/* Body: Palette | Canvas | Properties */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Palette */}
        <aside className="w-[200px] flex-shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-900/50 p-2">
          <CollapsibleSection title="CIRCUITS">
            {["RiskScore", "Anomaly", "Solvency", "Credit", "Performance"].map((l) => (
              <PaletteItem key={l} label={l} type="circuit" onDragStart={onNodeDragStart} />
            ))}
          </CollapsibleSection>
          <CollapsibleSection title="ENTITIES">
            {["Wallet", "Asset", "Pool"].map((l) => (
              <PaletteItem key={l} label={l} type="entity" onDragStart={onNodeDragStart} />
            ))}
          </CollapsibleSection>
          <CollapsibleSection title="LOGIC">
            {["IF/ELSE", "AND", "OR", "SPLIT"].map((l) => (
              <PaletteItem key={l} label={l} type="logic" onDragStart={onNodeDragStart} />
            ))}
          </CollapsibleSection>
          <CollapsibleSection title="VENUES">
            {["Ekubo LP", "Lending", "Staking", "Dark Ledger", "Reject"].map((l) => (
              <PaletteItem key={l} label={l} type="venue" onDragStart={onNodeDragStart} />
            ))}
          </CollapsibleSection>

          <CollapsibleSection title="MODELS" defaultOpen={false}>
            {models.length > 0 ? (
              models.map((m) => (
                <PaletteItem key={m.id} label={m.name} type="model" onDragStart={onNodeDragStart} />
              ))
            ) : (
              <div className="text-[10px] text-zinc-500 px-1 py-1">Loading models…</div>
            )}
          </CollapsibleSection>
        </aside>

        {/* Canvas */}
        <div className="flex-1">
          <ReactFlowProvider>
            <FlowCanvasInner
              nodes={nodes}
              setNodes={setNodes}
              onNodesChange={onNodesChange}
              edges={edges}
              setEdges={setEdges}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeDragStart={onNodeDragStart}
              selectedNode={selectedNode}
              onSelectNode={setSelectedNode}
            />
          </ReactFlowProvider>
        </div>

        {/* Properties Panel */}
        <aside className="w-[220px] flex-shrink-0 overflow-y-auto border-l border-zinc-800 bg-zinc-900/50 p-3">
          <div className="text-xs font-medium text-zinc-400 mb-2">Selected node</div>
          {selectedNode ? (
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-500 mb-0.5">Type</label>
                <div className="text-zinc-200">{selectedNode.type}</div>
              </div>
              <div>
                <label className="block text-zinc-500 mb-0.5">Label</label>
                <input
                  type="text"
                  value={(selectedNode.data?.label as string) || ""}
                  onChange={(e) => updateSelectedNodeData("label", e.target.value)}
                  className="w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-zinc-200"
                />
              </div>
              {selectedNode.type === "circuit" && (
                <div>
                  <label className="block text-zinc-500 mb-0.5">Threshold</label>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={(selectedNode.data?.threshold as number) ?? 0.5}
                    onChange={(e) => updateSelectedNodeData("threshold", parseFloat(e.target.value) || 0)}
                    className="w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-zinc-200"
                  />
                </div>
              )}
              {selectedNode.type === "venue" && (
                <div>
                  <label className="block text-zinc-500 mb-0.5">Allocation %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={(selectedNode.data?.allocation as number) ?? 100}
                    onChange={(e) => updateSelectedNodeData("allocation", parseInt(e.target.value, 10) || 0)}
                    className="w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-zinc-200"
                  />
                </div>
              )}
              {selectedNode.type === "logic" && (
                <>
                  {selectedNode.data?.logicType === "IF/ELSE" && (
                    <div>
                      <label className="block text-zinc-500 mb-0.5">Threshold</label>
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.1}
                        value={(selectedNode.data?.threshold as number) ?? 0.5}
                        onChange={(e) => updateSelectedNodeData("threshold", parseFloat(e.target.value) || 0)}
                        className="w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-zinc-200"
                      />
                    </div>
                  )}
                  {selectedNode.data?.logicType === "SPLIT" && (
                    <div>
                      <label className="block text-zinc-500 mb-0.5">Percentages (comma-separated)</label>
                      <input
                        type="text"
                        value={((selectedNode.data?.percentages as number[]) || [50, 50]).join(", ")}
                        onChange={(e) => {
                          const arr = e.target.value.split(",").map((s) => parseInt(s.trim(), 10) || 0).filter((n) => n > 0);
                          updateSelectedNodeData("percentages", arr.length ? arr : [50, 50]);
                        }}
                        className="w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-zinc-200"
                        placeholder="35, 20, 15"
                      />
                    </div>
                  )}
                </>
              )}
              {selectedNode.type === "model" && (
                <>
                  <div>
                    <label className="block text-zinc-500 mb-0.5">Model</label>
                    <select
                      value={(selectedNode.data?.label as string) || ""}
                      onChange={(e) => updateSelectedNodeData("label", e.target.value)}
                      className="w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-zinc-200 text-xs"
                    >
                      <option value="">Select model…</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.name}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-zinc-500 mb-0.5">Threshold</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={(selectedNode.data?.threshold as number) ?? 30}
                      onChange={(e) => updateSelectedNodeData("threshold", parseInt(e.target.value, 10) || 0)}
                      className="w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-zinc-200"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-500 mb-0.5">Confidence %</label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={((selectedNode.data?.confidence as number) ?? 0.8) * 100}
                      onChange={(e) => updateSelectedNodeData("confidence", parseInt(e.target.value, 10) / 100)}
                      className="w-full h-1.5 rounded-full appearance-none bg-zinc-800 accent-indigo-500"
                    />
                    <div className="text-right text-zinc-400 text-[10px]">
                      {(((selectedNode.data?.confidence as number) ?? 0.8) * 100).toFixed(0)}%
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="text-zinc-500 text-xs">Select a node to edit</div>
          )}
        </aside>
      </div>
    </div>
  );
}
