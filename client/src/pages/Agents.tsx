import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Bot, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiError } from '@/lib/api';
import type { Agent } from '@/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/EmptyState';
import { FullPageLoader } from '@/components/shared/LoadingSpinner';
import { RiskScore } from '@/components/shared/RiskScore';
import { formatDate } from '@/lib/utils';

type ConnState = 'pending' | 'connected' | 'unreachable';

export default function Agents() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [conn, setConn] = useState<Record<string, { state: ConnState; latencyMs?: number; error?: string }>>({});
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // SE-6 Verticals CTA — when set, every "open agent" link forwards the
  // selected vertical pack so the picker on AgentDetail pre-fills.
  const verticalPack = searchParams.get('verticalPack');
  const trailing = verticalPack ? `?verticalPack=${verticalPack}` : '';

  useEffect(() => {
    api
      .get<Agent[]>('/agents')
      .then((r) => {
        setAgents(r.data);
        // Probe each agent's reachability in parallel — keeps the page snappy
        // while the badges resolve. Each request stands on its own timeout
        // (server-side), so a slow agent doesn't stall the whole page.
        const initial: Record<string, { state: ConnState }> = {};
        r.data.forEach((a) => { initial[a.id] = { state: 'pending' }; });
        setConn(initial);
        r.data.forEach((a) => {
          api.get<{ ok: boolean; latencyMs: number; error?: string }>(`/agents/${a.id}/test-connection`)
            .then((p) => setConn((prev) => ({
              ...prev,
              [a.id]: {
                state: p.data.ok ? 'connected' : 'unreachable',
                latencyMs: p.data.latencyMs,
                error: p.data.error,
              },
            })))
            .catch(() => setConn((prev) => ({ ...prev, [a.id]: { state: 'unreachable', error: 'probe failed' } })));
        });
      })
      .catch((err) => toast.error(apiError(err)));
  }, []);

  if (agents == null) return <FullPageLoader />;

  return (
    <>
      <PageHeader
        title="Agents"
        description="AI agents and chatbots connected to Nemesis AI."
        actions={
          <Button asChild>
            <Link to="/agents/new">
              <Plus className="h-4 w-4" /> Connect New Agent
            </Link>
          </Button>
        }
      />

      {agents.length === 0 ? (
        <EmptyState
          icon={<Bot className="h-7 w-7" />}
          title="No agents yet"
          description="Connect your first AI agent to start running security tests."
          action={
            <Button asChild>
              <Link to="/agents/new">
                <Plus className="h-4 w-4" /> Connect New Agent
              </Link>
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last tested</TableHead>
                <TableHead className="text-right">Risk score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((a) => (
                <TableRow
                  key={a.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/agents/${a.id}${trailing}`)}
                >
                  <TableCell>
                    <Link
                      to={`/agents/${a.id}${trailing}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium text-foreground hover:text-indigo-600 dark:text-indigo-400"
                    >
                      {a.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{a.agentType}</TableCell>
                  <TableCell className="text-muted-foreground">{a.model}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant={a.status === 'active' ? 'success' : 'secondary'}>{a.status}</Badge>
                      {(() => {
                        const c = conn[a.id];
                        if (!c || c.state === 'pending') {
                          return <Badge variant="secondary" className="font-normal text-[10px]">checking…</Badge>;
                        }
                        if (c.state === 'connected') {
                          return (
                            <Badge variant="success" className="text-[10px]" title={c.latencyMs != null ? `${c.latencyMs} ms` : undefined}>
                              connected{c.latencyMs != null ? ` · ${c.latencyMs}ms` : ''}
                            </Badge>
                          );
                        }
                        return (
                          <Badge variant="destructive" className="text-[10px]" title={c.error ?? 'unreachable'}>
                            unreachable
                          </Badge>
                        );
                      })()}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(a.lastTestedAt)}</TableCell>
                  <TableCell className="flex justify-end">
                    {a.riskScore != null ? (
                      <RiskScore score={a.riskScore} size="sm" showLabel={false} />
                    ) : (
                      <span className="text-xs text-muted-foreground">Not tested</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
