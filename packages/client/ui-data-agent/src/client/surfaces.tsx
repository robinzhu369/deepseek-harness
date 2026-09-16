import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
/** Three persistent layout surfaces; all business state arrives through injected model hooks. */
import { useState, useRef, useEffect, type ReactNode } from 'react'
import { z } from 'zod'
import { Button, Input, Modal, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarOwnerProps, RightbarOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { Surface } from './face.ts'
import type { Session, Navigation, Run, Task, Registry, History, Proposal } from './types.ts'
import { Canvas } from './Canvas.tsx'
import { DataManager, SkillManager, TemplateManager } from './managers.tsx'
import css from './workbench.module.css'
/** A local mutation boundary exposes errors and prevents repeated clicks while awaiting a command. */
export function Action({
  children,
  run,
  disabled = false,
  t,
}: {
  children: ReactNode
  run: () => Promise<unknown>
  disabled?: boolean
  t: Surface['t']
}) {
  const latch = useRef(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  return (
    <span className={css.action}>
      <Button
        disabled={disabled || busy}
        onClick={() => {
          if (latch.current) return
          latch.current = true
          setBusy(true)
          setError('')
          void run()
            .catch((value: unknown) => {
              setError(value instanceof Error ? value.message : 'REQUEST_FAILED')
            })
            .finally(() => {
              latch.current = false
              setBusy(false)
            })
        }}
      >
        {busy ? t('busy') : children}
      </Button>
      {error && (
        <small role="alert" className={css.error}>
          {error}
        </small>
      )}
    </span>
  )
}
/** Session and project navigation remain mounted while manager dialogs are open. */
export function Sidebar(p: Surface & SidebarOwnerProps) {
  const view = p.useStore(value => value),
    domain = p.useDomain(value => value)
  const [credential, setCredential] = useState(''),
    [name, setName] = useState(''),
    [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0)
  useEffect(() => {
    p.actions.sidebarWidth(p.width)
  }, [p.actions, p.width])
  const base = '/v1/data/' + view.project,
    query =
      base + '/sessions?search=' + encodeURIComponent(search) + '&offset=' + String(offset) + '&limit=30'
  const projects = z
    .array(z.object({ id: z.string(), name: z.string() }))
    .parse(domain.cache['/v1/data/projects'] ?? [])
  const sessions = (domain.cache[query] ?? domain.cache[base + '/sessions'] ?? []) as Session[]
  return (
    <aside className={css.sidebar} style={{ width: p.width }} data-testid="data-sidebar">
      <header>
        <span className={css.mark}>{p.t('mark')}</span>
        <strong>{p.t('title')}</strong>
      </header>
      {!domain.authenticated ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
          }}
          className={css.stack}
        >
          <label>
            {p.t('credential')}
            <Input
              type="password"
              autoComplete="off"
              value={credential}
              onChange={(event) => {
                setCredential(event.target.value)
              }}
            />
          </label>
          <Action
            t={p.t}
            run={async () => {
              await p.login(credential)
              setCredential('')
            }}
          >
            {p.t('login')}
          </Action>
        </form>
      ) : (
        <>
          <label>
            {p.t('project')}
            <select
              aria-label={p.t('project')}
              value={view.project}
              onChange={(event) => {
                p.actions.project(event.target.value)
                void p.refresh()
              }}
            >
              <option value="">{p.t('choose')}</option>
              {projects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <details>
            <summary>{p.t('newProject')}</summary>
            <Input
              aria-label={p.t('projectName')}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
              }}
            />
            <Action
              t={p.t}
              run={async () => {
                const project = z
                  .object({ id: z.string() })
                  .parse(await p.command('/v1/data/projects', { name }))
                p.actions.project(project.id)
                setName('')
                await p.refresh()
              }}
            >
              {p.t('create')}
            </Action>
          </details>
          <Button
            disabled={!view.project}
            onClick={() => {
              p.actions.session('')
            }}
          >
            {p.t('newSession')}
          </Button>
          <nav className={css.managers}>
            {(['data', 'skills', 'templates'] as const).map(manager => (
              <Button
                key={manager}
                disabled={!view.project}
                variant="ghost"
                onClick={() => {
                  p.actions.manager(manager)
                }}
              >
                {p.t(manager)}
              </Button>
            ))}
          </nav>
          <div className={css.row}>
            <Input
              placeholder={p.t('search')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setOffset(0)
              }}
            />
            <Action t={p.t} disabled={!view.project} run={() => p.read(query)}>
              {p.t('search')}
            </Action>
          </div>
          <div className={css.sessionList}>
            {sessions.map(session => (
              <button
                type="button"
                key={session.id}
                className={session.id === view.session ? css.selected : css.session}
                onClick={() => {
                  p.actions.session(session.id)
                  void p.refresh()
                }}
              >
                <strong>{session.title || session.input.goal}</strong>
                <small>
                  {new Date(session.updated_at).toLocaleDateString()} · {session.status}
                </small>
              </button>
            ))}
          </div>
          <div className={css.row}>
            <Button
              disabled={offset === 0}
              onClick={() => {
                setOffset(Math.max(0, offset - 30))
                void p
                  .read(
                    base +
                      '/sessions?search=' +
                      encodeURIComponent(search) +
                      '&offset=' +
                      String(Math.max(0, offset - 30)) +
                      '&limit=30',
                  )
                  .catch(() => {
                    /* The model retains the error for the current view. */
                  })
              }}
            >
              {p.t('previous')}
            </Button>
            <Button
              disabled={sessions.length < 30}
              onClick={() => {
                setOffset(offset + 30)
                void p
                  .read(
                    base +
                      '/sessions?search=' +
                      encodeURIComponent(search) +
                      '&offset=' +
                      String(offset + 30) +
                      '&limit=30',
                  )
                  .catch(() => {
                    /* The model retains the error for the current view. */
                  })
              }}
            >
              {p.t('more')}
            </Button>
          </div>
          <footer>
            <span>{domain.actor}</span>
            <Button variant="ghost" onClick={p.logout}>
              {p.t('logout')}
            </Button>
          </footer>
        </>
      )}
    </aside>
  )
}
/** Conversation projects the existing Harness event stream, plus authoritative business proposal cards. */
export function Conversation(p: Surface) {
  const view = p.useStore(value => value),
    domain = p.useDomain(value => value),
    base = '/v1/data/' + view.project
  const sessions = (domain.cache[base + '/sessions'] ?? []) as Session[],
    session = sessions.find(value => value.id === view.session)
  const navigation = domain.cache[base + '/sessions/' + view.session + '/navigation'] as
    | Navigation
    | undefined
  const history = domain.cache[base + '/sessions/' + view.session + '/history'] as History | undefined
  const [title, setTitle] = useState('')
  const failures = Object.entries(domain.errors).filter(
    ([path, error]) =>
      error &&
      (path === '/v1/data/projects' ||
        path === base + '/workbench' ||
        path.startsWith(base + '/sessions/' + view.session + '/')),
  )
  return (
    <main className={css.conversation} data-testid="data-conversation">
      <header>
        <div>
          <small>{p.t('sessions')}</small>
          <h2>{session?.title || session?.input.goal || p.t('title')}</h2>
        </div>
        <span className={failures.length || !domain.online ? css.offline : css.online}>
          {p.t(failures.length || !domain.online ? 'offline' : 'ready')}
        </span>
        <Action t={p.t} run={p.refresh}>
          {p.t('refresh')}
        </Action>
      </header>
      {!domain.authenticated ? (
        <div className={css.empty}>{p.t('credential')}</div>
      ) : !view.session ? (
        <NewSession {...p} key={view.project} />
      ) : (
        <>
          <div className={css.row}>
            <span className={css.badge}>{p.t(history?.activity === 'working' ? 'thinking' : 'idle')}</span>
            <details>
              <summary>{p.t('rename')}</summary>
              <Input
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value)
                }}
                aria-label={p.t('name')}
              />
              <Action
                t={p.t}
                run={async () => {
                  await p.command(base + '/sessions/' + view.session + '/rename', { title })
                  await p.refresh()
                }}
              >
                {p.t('save')}
              </Action>
            </details>
            <Action
              t={p.t}
              run={async () => {
                await p.command(base + '/sessions/' + view.session + '/resume', {})
                await p.refresh()
              }}
            >
              {p.t('resumeSession')}
            </Action>
            <Action t={p.t} run={() => p.command(base + '/sessions/' + view.session + '/cancel', {})}>
              {p.t('cancelChat')}
            </Action>
          </div>
          <div className={css.transcript}>
            {session && (
              <section className={css.card}>
                <small>{p.t('immutableInput')}</small>
                <p>{session.input.goal}</p>
                <code>{session.input.dataset.artifact_id}</code>
              </section>
            )}
            {failures.map(([path, error]) => (
              <p key={path} role="alert" className={css.error}>
                {error}
              </p>
            ))}
            {(history?.events ?? []).slice(-200).map(event => (
              <EventCard key={event.seq} event={event} t={p.t} />
            ))}
            {(navigation?.proposals ?? []).map(proposal => (
              <ProposalCard key={proposal.id + ':' + proposal.digest} {...p} proposal={proposal} />
            ))}
            {history?.has_more && (
              <Action t={p.t} run={p.refresh}>
                {p.t('more')}
              </Action>
            )}
            {(history?.events.length ?? 0) > 200 && <small>{p.t('latestOnly')}</small>}
          </div>
          <Composer {...p} key={view.project + ':' + view.session} />
        </>
      )}
    </main>
  )
}
function EventCard({ event, t }: { event: History['events'][number]; t: Surface['t'] }) {
  const data = event.data
  // Event variants remain extensible: unknown records retain their exact JSON in the transcript.
  const object = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  if (!['user/message', 'assistant/message', 'tool/call', 'tool/result', 'turn/end'].includes(event.type))
    return null
  if (
    event.type === 'turn/end' &&
    !z.object({ reason: z.object({ kind: z.literal('error') }) }).safeParse(object).success
  )
    return null
  if (
    event.type === 'user/message' &&
    z.object({ source: z.object({ kind: z.literal('data-agent-context') }) }).safeParse(object).success
  )
    return null
  const message =
    object.message && typeof object.message === 'object' && !Array.isArray(object.message)
      ? object.message
      : object
  const blocks = Array.isArray(message.content) ? message.content : []
  const content = blocks.flatMap(block =>
    block &&
    typeof block === 'object' &&
    !Array.isArray(block) &&
    block.type === 'tool-result' &&
    Array.isArray(block.content)
      ? block.content
      : [block],
  )
  const text = content
    .flatMap(part =>
      part &&
      typeof part === 'object' &&
      !Array.isArray(part) &&
      part.type === 'text' &&
      typeof part.text === 'string'
        ? [part.text]
        : [],
    )
    .join('\n')
  const failure = z
    .object({ reason: z.object({ kind: z.literal('error'), error: z.object({ message: z.string() }) }) })
    .safeParse(object)
  return (
    <article className={css.event}>
      <small>
        {event.seq} · {event.type}
      </small>
      {failure.success && (
        <p role="alert" className={css.error}>
          {failure.data.reason.error.message}
        </p>
      )}
      {text ? (
        <MarkdownText
          text={text}
          labels={{ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }}
        />
      ) : (
        <details>
          <summary>{t('rawEvents')}</summary>
          <pre>{JSON.stringify(event.data, null, 2)}</pre>
        </details>
      )}
    </article>
  )
}
function Composer(p: Surface) {
  const view = p.useStore(value => value),
    [text, setText] = useState('')
  return (
    <form
      className={css.composer}
      onSubmit={(event) => {
        event.preventDefault()
      }}
    >
      <textarea
        aria-label={p.t('message')}
        placeholder={p.t('message')}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
        }}
      />
      <Action
        t={p.t}
        disabled={!text.trim()}
        run={async () => {
          await p.command('/v1/data/' + view.project + '/sessions/' + view.session + '/messages', { text })
          setText('')
          await p.refresh()
        }}
      >
        {p.t('send')}
      </Action>
    </form>
  )
}
function NewSession(p: Surface) {
  const view = p.useStore(value => value),
    domain = p.useDomain(value => value),
    base = '/v1/data/' + view.project,
    registry = domain.cache[base + '/workbench'] as Registry | undefined
  const [goal, setGoal] = useState(''),
    [dataset, setDataset] = useState(''),
    [skillIds, setSkillIds] = useState(''),
    [scope, setScope] = useState('undefined'),
    [task, setTask] = useState(true)
  const rows = z
    .array(
      z.object({
        dataset_id: z.string().nullable(),
        dataset_digest: z.string().nullable(),
        filename: z.string(),
        status: z.string(),
      }),
    )
    .parse(domain.cache[base + '/datasets'] ?? [])
  return (
    <section className={css.newSession}>
      <span className={css.eyebrow}>{p.t('newSession')}</span>
      <h1>{p.t('selectDataset')}</h1>
      <p>{p.t('immutableInput')}</p>
      <Action t={p.t} disabled={!view.project} run={() => p.read(base + '/datasets')}>
        {p.t('refresh')}
      </Action>
      <label>
        {p.t('dataset')}
        <select
          value={dataset}
          onChange={(event) => {
            setDataset(event.target.value)
          }}
        >
          <option value="">{p.t('choose')}</option>
          {rows
            .filter(row => row.status === 'ready')
            .map(row => (
              <option key={row.dataset_id} value={row.dataset_id ?? ''}>
                {row.filename} · {row.dataset_id}
              </option>
            ))}
        </select>
      </label>
      <label>
        {p.t('goal')}
        <textarea
          value={goal}
          onChange={(event) => {
            setGoal(event.target.value)
          }}
        />
      </label>
      <label>
        {p.t('selectedSkills')}
        <Input
          value={skillIds}
          onChange={(event) => {
            setSkillIds(event.target.value)
          }}
        />
      </label>
      <small>{p.t('noReleased')}</small>
      <label>
        {p.t('fitScope')}
        <select
          value={scope}
          onChange={(event) => {
            setScope(event.target.value)
          }}
        >
          <option value="undefined">{p.t('undefined')}</option>
          <option value="train">{p.t('train')}</option>
        </select>
      </label>
      <small>{p.t('fitNote')}</small>
      <label>
        <input
          type="checkbox"
          checked={task}
          onChange={(event) => {
            setTask(event.target.checked)
          }}
        />
        {p.t('newTask')}
      </label>
      <Action
        t={p.t}
        disabled={!dataset || !goal.trim() || !registry?.runtime || registry.role === 'viewer'}
        run={async () => {
          if (!registry?.runtime) throw new Error('RUNTIME_REQUIRED')
          const row = rows.find(value => value.dataset_id === dataset)
          if (!row?.dataset_digest) throw new Error('DATASET_NOT_FOUND')
          const ref = {
            project_id: view.project,
            artifact_id: dataset,
            digest: row.dataset_digest,
            kind: 'DatasetRef',
          }
          const businessTask = task
            ? z.object({ task_id: z.string() }).parse(
              await p.command(base + '/tasks', {
                name: goal.slice(0, 256),
                goal,
                dataset: ref,
                idempotency_key: randomUUID(),
              }),
            ).task_id
            : null
          const session = z.object({ session_id: z.string() }).parse(
            await p.command(base + '/sessions', {
              business_task_id: businessTask,
              input: {
                project_id: view.project,
                dataset: ref,
                workflow_revision: 0,
                goal,
                fit_scope: scope,
                policy_version: registry.runtime.policy_version,
              },
              skills: skillIds
                .split(',')
                .map(id => id.trim())
                .filter(Boolean)
                .map(id => ({ id, version: null })),
            }),
          )
          p.actions.session(session.session_id)
          await p.refresh()
        }}
      >
        {p.t('create')}
      </Action>
    </section>
  )
}
function ProposalCard(p: Surface & { proposal: Proposal }) {
  const view = p.useStore(value => value),
    [reason, setReason] = useState(''),
    [threshold, setThreshold] = useState('0'),
    proposal = p.proposal,
    base = '/v1/data/' + view.project
  const domain = p.useDomain(value => value),
    session = ((domain.cache[base + '/sessions'] ?? []) as Session[]).find(row => row.id === view.session),
    task = session?.business_task_id
      ? (domain.cache[base + '/tasks/' + session.business_task_id] as Task | undefined)
      : undefined
  const submitted = (
    domain.cache[base + '/sessions/' + view.session + '/navigation'] as Navigation | undefined
  )?.runs.some(
    run => run.snapshot.workflow_id === proposal.workflow_id && run.snapshot.revision === proposal.revision,
  )
  const [stage, setStage] = useState('analysis'),
    [previous, setPrevious] = useState('')
  return (
    <section className={css.card} data-testid="proposal-card">
      <div className={css.row}>
        <strong>{p.t('proposal')}</strong>
        <span className={css.badge}>{proposal.status}</span>
      </div>
      <p>{proposal.body.goal}</p>
      <code>
        {proposal.workflow_id} · {proposal.revision}
      </code>
      <details>
        <summary>{p.t('evidence')}</summary>
        <pre>{JSON.stringify(proposal.body, null, 2)}</pre>
        <code>{proposal.digest}</code>
      </details>
      <Input
        aria-label={p.t('reason')}
        placeholder={p.t('reason')}
        value={reason}
        onChange={(event) => {
          setReason(event.target.value)
        }}
      />
      <label>
        {p.t('threshold')}
        <Input
          type="number"
          min={0}
          max={1}
          step={0.01}
          value={threshold}
          onChange={(event) => {
            setThreshold(event.target.value)
          }}
        />
      </label>
      {task && (
        <label>
          {p.t('phases')}
          <select
            value={stage}
            onChange={(event) => {
              setStage(event.target.value)
            }}
          >
            {(['analysis', 'processing', 'features'] as const).map(value => (
              <option key={value} value={value}>
                {p.t(value)}
              </option>
            ))}
          </select>
        </label>
      )}
      {task && stage !== 'analysis' && (
        <label>
          {p.t('previousRun')}
          <select
            value={previous}
            onChange={(event) => {
              setPrevious(event.target.value)
            }}
          >
            <option value="">{p.t('current')}</option>
            {task.runs
              .filter(run => run.status === 'succeeded')
              .map(run => (
                <option key={run.id} value={run.id}>
                  {run.stage} · {run.id}
                </option>
              ))}
          </select>
        </label>
      )}
      <div className={css.row}>
        {(['approve', 'reject'] as const).map(action => (
          <Action
            key={action}
            t={p.t}
            disabled={!reason.trim() || proposal.status !== 'pending'}
            run={async () => {
              await p.command(base + '/proposals/' + proposal.id + '/decision', {
                action,
                digest: proposal.digest,
                reason,
                ...(action === 'approve' ? { max_removed_fraction: Number(threshold) } : {}),
              })
              await p.refresh()
            }}
          >
            {p.t(action)}
          </Action>
        ))}
        <Action
          t={p.t}
          disabled={proposal.status !== 'approved' || !!submitted}
          run={async () => {
            await p.command(
              task
                ? base + '/tasks/' + task.task_id + '/submit'
                : base + '/proposals/' + proposal.id + '/submit',
              task
                ? {
                  proposal_id: proposal.id,
                  stage,
                  previous_run_id: stage === 'analysis' ? null : previous || task.selected_run_id,
                  source_run_id: null,
                  scope: { kind: 'all' },
                  reuse: true,
                  select: true,
                  expected_revision: task.revision,
                  idempotency_key: 'workbench-' + proposal.id,
                }
                : { idempotency_key: 'workbench-' + proposal.id },
            )
            await p.refresh()
          }}
        >
          {p.t('submit')}
        </Action>
        <Button
          onClick={() => {
            p.actions.draft(view.session, {
              evidence: Array.isArray(proposal.body.evidence) ? proposal.body.evidence : [],
              workflow: proposal.body.workflow,
              workflowId: randomUUID(),
              revision: 0,
              selectedNode: null,
            })
            p.actions.tab('flow')
          }}
        >
          {p.t('copyDraft')}
        </Button>
      </div>
    </section>
  )
}
/** Right column keeps task status and the flow editor in two tabs within the same track. */
export function Rightbar(p: Surface & RightbarOwnerProps) {
  const view = p.useStore(value => value),
    domain = p.useDomain(value => value),
    base = '/v1/data/' + view.project
  const navigation = domain.cache[base + '/sessions/' + view.session + '/navigation'] as
      | Navigation
      | undefined,
    id = view.selectedRuns[view.session] || navigation?.runs[0]?.id
  const run = id ? (domain.cache[base + '/runs/' + id] as Run | undefined) : undefined
  const session = ((domain.cache[base + '/sessions'] ?? []) as Session[]).find(
      row => row.id === view.session,
    ),
    task = session?.business_task_id
      ? (domain.cache[base + '/tasks/' + session.business_task_id] as Task | undefined)
      : undefined
  if (!domain.authenticated)
    return <aside className={css.rightbar} style={{ width: p.width }} data-testid="data-rightbar" />
  return (
    <aside className={css.rightbar} style={{ width: p.width }} data-testid="data-rightbar">
      <header>
        <strong>{p.t('currentRun')}</strong>
        <Button
          variant="ghost"
          onClick={() => {
            p.saveColumns(p.width)
          }}
        >
          {p.t('saveColumns')}
        </Button>
      </header>
      <div className={css.tabs}>
        {(['status', 'flow'] as const).map(tab => (
          <Button
            key={tab}
            variant={view.tab === tab ? 'primary' : 'ghost'}
            onClick={() => {
              p.actions.tab(tab)
            }}
          >
            {p.t(tab)}
          </Button>
        ))}
      </div>
      <label>
        {p.t('selectRun')}
        <select
          aria-label={p.t('selectRun')}
          value={view.selectedRuns[view.session] ?? ''}
          onChange={(event) => {
            p.actions.run(view.session, event.target.value)
            void p.refresh()
          }}
        >
          <option value="">{p.t('latest')}</option>
          {navigation?.runs.map(row => (
            <option key={row.id} value={row.id}>
              {row.stage ?? p.t('currentRun')} · {row.status} · {row.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      {id && (
        <details className={css.card}>
          <summary>{p.t('runIdentity')}</summary>
          <pre>
            {JSON.stringify(
              navigation?.runs.find(row => row.id === id),
              null,
              2,
            )}
          </pre>
        </details>
      )}
      {view.tab === 'flow' ? (
        <Canvas
          key={
            view.session +
            ':' +
            (view.canvasModes[view.session] ?? 'draft') +
            ':' +
            (view.drafts[view.session]?.workflowId ?? 'history')
          }
          {...p}
          run={navigation?.runs.find(row => row.id === id)}
          registry={domain.cache[base + '/workbench'] as Registry | undefined}
        />
      ) : (
        <div className={css.scroll}>
          <div className={css.phases}>
            {(['analysis', 'processing', 'features', 'export'] as const).map(stage => (
              <span key={stage} className={run?.stage === stage ? css.phaseActive : css.phase}>
                {p.t(stage)}
              </span>
            ))}
          </div>
          {run ? (
            <RunPanel {...p} key={run.run_id} run={run} task={task} />
          ) : (
            <div className={css.empty}>{p.t('noRun')}</div>
          )}
        </div>
      )}
    </aside>
  )
}
function RunPanel(p: Surface & { run: Run; task: Task | undefined }) {
  const view = p.useStore(value => value),
    [scope, setScope] = useState('all'),
    [node, setNode] = useState(''),
    [reuse, setReuse] = useState(true),
    run = p.run,
    base = '/v1/data/' + view.project
  return (
    <>
      <section className={css.card}>
        <strong>{run.status}</strong>
        <code>{run.run_id}</code>
        <small>
          {p.t('taskRevision')}: {p.task?.revision ?? '—'} · {p.task?.status}
        </small>
        <div className={css.row}>
          {(['pause', 'resume', 'cancel'] as const).map(action => (
            <Action
              key={action}
              t={p.t}
              run={async () => {
                await p.command(base + '/runs/' + run.run_id + '/' + action, {})
                await p.refresh()
              }}
            >
              {p.t(action === 'cancel' ? 'cancelRun' : action)}
            </Action>
          ))}
          {p.task && (
            <>
              <Action
                t={p.t}
                run={async () => {
                  if (!p.task) return
                  await p.command(base + '/tasks/' + p.task.task_id + '/select', {
                    run_id: run.run_id,
                    expected_revision: p.task.revision,
                  })
                  await p.refresh()
                }}
              >
                {p.t('selectBranch')}
              </Action>
              <Action
                t={p.t}
                run={async () => {
                  if (!p.task) return
                  await p.command(base + '/tasks/' + p.task.task_id + '/cancel', {})
                  await p.refresh()
                }}
              >
                {p.t('cancelTask')}
              </Action>
            </>
          )}
        </div>
      </section>
      <div className={css.nodes}>
        {run.nodes.map(node => (
          <section className={css.card} key={node.node_id}>
            <strong>{node.node_id}</strong>
            <span>{node.status}</span>
            {node.progress && (
              <>
                <small>
                  {node.progress.processed}
                  {node.progress.total !== undefined ? ' / ' + String(node.progress.total) : ''}
                </small>
                {node.progress.total !== undefined && node.progress.total > 0 && (
                  <progress value={node.progress.processed} max={node.progress.total} />
                )}
              </>
            )}
            {node.status === 'computed_waiting_approval' && <Candidate {...p} job={node.job_id} />}{' '}
            {node.error_code && <small className={css.error}>{node.error_code}</small>}
            {node.reused_from_job_id && <small>{p.t('reuse')}</small>}
          </section>
        ))}
      </div>
      {p.task && (
        <details className={css.card}>
          <summary>{p.t('rerun')}</summary>
          <select
            value={scope}
            onChange={(event) => {
              setScope(event.target.value)
            }}
          >
            {(['all', 'through', 'from'] as const).map(value => (
              <option key={value} value={value}>
                {p.t(value)}
              </option>
            ))}
          </select>
          {scope !== 'all' && (
            <select
              value={node}
              onChange={(event) => {
                setNode(event.target.value)
              }}
            >
              <option value="">{p.t('choose')}</option>
              {run.nodes.map(value => (
                <option key={value.node_id}>{value.node_id}</option>
              ))}
            </select>
          )}
          <label>
            <input
              type="checkbox"
              checked={reuse}
              onChange={(event) => {
                setReuse(event.target.checked)
              }}
            />
            {p.t('reuse')}
          </label>
          <Action
            t={p.t}
            disabled={scope !== 'all' && !node}
            run={async () => {
              if (!p.task) return
              await p.command(base + '/runs/' + run.run_id + '/rerun', {
                scope: scope === 'all' ? { kind: scope } : { kind: scope, node_id: node },
                reuse,
                select: true,
                expected_revision: p.task.revision,
                idempotency_key: randomUUID(),
              })
              await p.refresh()
            }}
          >
            {p.t('rerun')}
          </Action>
        </details>
      )}
      <h3>{p.t('artifacts')}</h3>
      {run.artifacts.map(artifact => (
        <section className={css.card} key={artifact.id}>
          <strong>{artifact.kind}</strong>
          <code>{artifact.id}</code>
          <small>{artifact.bytes} B</small>
          <div className={css.row}>
            <Action
              t={p.t}
              run={() => p.download(base + '/artifacts/' + artifact.id + '/download', artifact.id)}
            >
              {p.t('download')}
            </Action>
            <Action t={p.t} run={() => p.command(base + '/artifacts/' + artifact.id + '/archive', {})}>
              {p.t('archive')}
            </Action>
          </div>
        </section>
      ))}
    </>
  )
}
/** Manager closure preserves all three surface selections and workflow drafts. */
export function Manager(p: Surface) {
  const view = p.useStore(value => value),
    domain = p.useDomain(value => value)
  return (
    <Modal
      open={domain.authenticated && view.manager !== null}
      onClose={() => {
        p.actions.manager(null)
      }}
      title={view.manager ? p.t(view.manager) : ''}
      closeLabel={p.t('close')}
      description={p.t('retained')}
      className={css.manager ?? ''}
    >
      <div className={css.managerContent}>
        {Object.entries(domain.errors)
          .filter(([path, error]) => error && path.startsWith('/v1/data/' + view.project + '/'))
          .map(([path, error]) => (
            <p key={path} role="alert" className={css.error}>
              {error}
            </p>
          ))}
        {view.manager === 'data' ? (
          <DataManager {...p} key={view.project} />
        ) : view.manager === 'skills' ? (
          <SkillManager {...p} key={view.project} />
        ) : view.manager === 'templates' ? (
          <TemplateManager {...p} key={view.project} />
        ) : null}
      </div>
    </Modal>
  )
}

function Candidate(p: Surface & { run: Run; job: string }) {
  const view = p.useStore(value => value),
    [value, setValue] = useState<unknown>(),
    [reason, setReason] = useState(''),
    path = '/v1/data/' + view.project + '/runs/' + p.run.run_id + '/candidates/' + p.job
  return (
    <div className={css.stack}>
      <Action
        t={p.t}
        run={async () => {
          setValue(await p.read(path))
        }}
      >
        {p.t('inspectCandidate')}
      </Action>
      {value !== undefined && (
        <>
          <strong>{p.t('candidateImpact')}</strong>
          <pre>{JSON.stringify(value, null, 2)}</pre>
          <Input
            aria-label={p.t('reason')}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value)
            }}
          />
          <div className={css.row}>
            {(['approve', 'reject'] as const).map(action => (
              <Action
                key={action}
                t={p.t}
                disabled={!reason.trim()}
                run={async () => {
                  const candidate = z.object({ manifest_digest: z.string() }).parse(value)
                  await p.command(path + '/decision', {
                    action,
                    reason,
                    manifest_digest: candidate.manifest_digest,
                  })
                  setValue(undefined)
                  await p.refresh()
                }}
              >
                {p.t(action)}
              </Action>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
