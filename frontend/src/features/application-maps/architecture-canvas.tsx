"use client";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import {
  Box,
  Database,
  Layers,
  Globe,
  Server,
  Network,
  Workflow,
  TriangleAlert,
} from "lucide-react";
import type { CanvasNode, CanvasEdge } from "./studio-types";
import "@xyflow/react/dist/style.css";
function ServiceNode({ data }: NodeProps<CanvasNode>) {
  const icons: Record<string, typeof Box> = {
    service: Server,
    frontend: Globe,
    database: Database,
    cache: Layers,
    queue: Workflow,
    gateway: Network,
    external: Globe,
  };
  const Icon = icons[data.icon || data.kind || ""] || Box;
  return (
    <div className="studio-node" style={{ background: data.color }}>
      <Handle type="target" position={Position.Left} />
      <div className="studio-node-heading">
        <Icon size={18} />
        <strong>{data.label}</strong>
        {data.hasWarning && (
          <TriangleAlert size={16} aria-label="Owner warning" />
        )}
      </div>
      <span>{data.subtitle}</span>
      <small>
        {data.kind}
        {data.hasCache ? " · cache declaration" : ""}
      </small>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
function BoundaryNode({ data }: NodeProps<CanvasNode>) {
  return <div className="studio-boundary-label" title={data.description}>{data.label}<small>{data.description}</small></div>;
}
const nodeTypes: NodeTypes = { service: ServiceNode, group: BoundaryNode };
export default function ArchitectureCanvas({
  initialNodes,
  initialEdges,
  onSelect,
  onPositions,
  highlight = [],
}: {
  initialNodes: CanvasNode[];
  initialEdges: CanvasEdge[];
  onSelect: (ids: string[]) => void;
  onPositions: (positions: Record<string, { x: number; y: number }>) => void;
  highlight?: string[];
}) {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const shownNodes = nodes.map((n) => ({
    ...n,
    style: {
      ...n.style,
      ...(highlight.includes(n.id) ? { boxShadow: "0 0 0 3px #8d75ef" } : {}),
    },
  }));
  return (
    <div
      className="studio-canvas"
      aria-label="Interactive application architecture canvas"
    >
      <ReactFlow
        nodes={shownNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          if (node.type !== "group") onSelect(node.data.members || []);
        }}
        onNodeDragStop={() =>
          onPositions(
            Object.fromEntries(
              nodes
                .filter((n) => n.type === "service" && n.id.startsWith("n"))
                .map((n) => [n.id, n.position]),
            ),
          )
        }
        nodesConnectable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.1}
        maxZoom={3}
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => String(n.data.color || "#d9deea")}
          pannable
          zoomable
        />
      </ReactFlow>
      <div className="studio-canvas-hint">
        Drag nodes · pan the canvas · select a component to trace impact
      </div>
    </div>
  );
}
