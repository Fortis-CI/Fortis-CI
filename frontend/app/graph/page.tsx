'use client';

import { useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { fetchServices } from '../../services/api';

// Dynamic import with SSR disabled because force-graph relies on window/canvas
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function GraphPage() {
  const fgRef = useRef<any>();
  const [activeTab, setActiveTab] = useState<'dependencies' | 'chain'>('dependencies');
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [selectedService, setSelectedService] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchServices().then(data => {
      setServices(data.map(s => ({ id: s.id, name: s.name })));
      if (data.length > 0) setSelectedService(data[0].id);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    let url = `${API_BASE}/api/graph/service-dependencies`;
    if (activeTab === 'chain' && selectedService) {
      url = `${API_BASE}/api/graph/deployment-chain/${selectedService}`;
    }

    setLoading(true);
    fetch(url)
      .then(r => r.json())
      .then(res => setGraphData(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [activeTab, selectedService]);

  useEffect(() => {
    if (fgRef.current) {
      // Configure physics to spread nodes further apart
      fgRef.current.d3Force('charge').strength(-600); 
      fgRef.current.d3Force('link').distance(120);
    }
  }, [graphData]);

  const nodeColor = (node: any) => {
    if (node.group === 'Service') return '#3b82f6'; // blue
    if (node.group === 'Success') return '#10b981'; // green
    if (node.group === 'Failure') return '#ef4444'; // red
    return '#9ca3af'; // gray
  };

  return (
    <div>
      <div className="page-header" style={{ marginBottom: '16px' }}>
        <h1>Interactive Graph</h1>
        <p>Visualize your deployment topology and failure chains.</p>
      </div>

      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
        <button
          className={`btn ${activeTab === 'dependencies' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('dependencies')}
        >
          Service Dependencies
        </button>
        <button
          className={`btn ${activeTab === 'chain' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('chain')}
        >
          Deployment Chain
        </button>

        {activeTab === 'chain' && (
          <select 
            value={selectedService} 
            onChange={e => setSelectedService(e.target.value)}
            style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)' }}
          >
            {services.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="card" style={{ height: '600px', overflow: 'hidden', padding: 0, position: 'relative' }}>
        {loading && (
          <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10 }}>Loading graph...</div>
        )}
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          nodeLabel="name"
          nodeRelSize={6}
          linkColor={() => 'rgba(255,255,255,0.4)'}
          linkWidth={2}
          linkDirectionalArrowLength={5}
          linkDirectionalArrowRelPos={1}
          d3VelocityDecay={0.3} // higher decay to stop them moving infinitely
          onEngineStop={() => {
            // Optional: fit to canvas once simulation settles
          }}
          nodeCanvasObject={(node: any, ctx, globalScale) => {
            const size = Math.sqrt(node.val || 20) * 2; // custom radius sizing
            
            // Draw Circle
            ctx.beginPath();
            ctx.arc(node.x, node.y, size, 0, 2 * Math.PI, false);
            ctx.fillStyle = nodeColor(node);
            ctx.fill();

            // Draw Text
            const label = node.name;
            const fontSize = Math.max(12 / globalScale, 4); // readable font size
            ctx.font = `${fontSize}px Sans-Serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // white text
            ctx.fillText(label, node.x, node.y + size + 2);
          }}
          onNodeClick={node => {
            console.log('Clicked node', node);
          }}
          onNodeDragEnd={node => {
            // Pin the node at its new dragged position
            node.fx = node.x;
            node.fy = node.y;
          }}
        />
      </div>
    </div>
  );
}
