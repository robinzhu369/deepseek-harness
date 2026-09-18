import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
/** Three persistent layout surfaces; all business state arrives through injected model hooks. */
import { useState, useRef, useEffect, type ReactNode } from 'react'
import { z } from 'zod'
import { Button, Input, Modal, MarkdownText, IconDatabaseOutline16, IconEnhanceOutline16, IconBranchOutline16, IconSettingsOutline16, IconPlusOutline16, IconSearchOutline16, IconEditOutline16, IconTrashOutline16, IconSendOutline14, IconCloseOutline16, IconPanelLeftOutline16, IconDataOutline16, IconContextInjectionOutline16, IconLoadingOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarOwnerProps, RightbarOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { Surface } from './face.ts'
import type { Session, Navigation, Run, Task, Registry, History, Proposal } from './types.ts'
import { ModelConfiguration, ModelChoice } from './ModelConfiguration.tsx'
import { Canvas } from './Canvas.tsx'
import { DatasetMount } from './DatasetMount.tsx'
import { DataManager, SkillManager, TemplateManager } from './managers.tsx'
import css from './workbench.module.css'
/** A local mutation boundary exposes errors and prevents repeated clicks while awaiting a command. */
export function Action({
  children,
  run,
  disabled = false,
  t,
  primary = false,
  icon,
  label,
}: {
  children: ReactNode
  run: () => Promise<unknown>
  disabled?: boolean
  t: Surface['t']
  icon?: ReactNode
  label?: string
  primary?: boolean
}) {
  const latch = useRef(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  return (
    <span className={css.action}>
      <Button
        variant={primary ? 'primary' : 'outline'}
        className={[primary ? css.primaryAction : '', icon ? css.iconButton : ''].join(' ')}
        aria-label={busy ? t('busy') : label}
        title={busy ? t('busy') : label}
        aria-busy={busy}
        disabled={disabled || busy}
        onClick={() => {
          if (latch.current) return
          latch.current = true
          setBusy(true)
          setError('')
          void run()
            .catch((value: unknown) => {
              const code = value instanceof Error ? value.message : 'REQUEST_FAILED'
              setError(code === 'GOAL_GENERATION_FAILED' ? t('goalFailed') : code === 'SESSION_BUSY' ? t('sessionBusy') : code)
            })
            .finally(() => {
              latch.current = false
              setBusy(false)
            })
        }}
      >
        {icon ? <span aria-hidden="true">{busy ? <IconLoadingOutline16 /> : icon}</span> : busy ? t('busy') : children}
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
  const sessions = (domain.cache[query] ?? (!search && offset === 0 ? domain.cache[base + '/sessions'] : undefined) ?? []) as Session[]
  useEffect(() => { setSearch(''); setOffset(0) }, [view.project])
  if (p.collapsed) return <aside className={css.sidebar} style={{ width: p.width }} data-testid="data-sidebar"><Button aria-label={p.t('title')} onClick={p.toggleSidebar}>{p.t('mark')}</Button></aside>
  return (
    <aside className={css.sidebar} style={{ width: p.width }} data-testid="data-sidebar">
      <header>
        <span className={css.mark}>{p.t('mark')}</span>
        <strong>{p.t('title')}</strong>
        <Button className={css.iconButton} aria-label={p.t('toggleNavigation')} title={p.t('toggleNavigation')} onClick={p.toggleSidebar}><IconPanelLeftOutline16 /></Button>
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
          <Button onClick={() =>{  p.actions.manager('models') }}>{p.t('models')}</Button>
        </form>
      ) : (
        <>
          <div className={css.sidebarTop}>
            <Button
              icon={<IconPlusOutline16 />}
              className={css.newTaskNav}
              aria-current={!view.session ? 'page' : undefined}
              variant="ghost"
              disabled={!view.project}
              onClick={() => {
                p.actions.session('')
                p.monitor(false)
              }}
            >
              {p.t('newSession')}
            </Button>
            <nav className={css.managers}>
              {(['data', 'skills', 'templates'] as const).map(manager => (
                <Button
                  key={manager}
                  icon={manager === 'data' ? <IconDatabaseOutline16 /> : manager === 'skills' ? <IconEnhanceOutline16 /> : <IconBranchOutline16 />}
                  title={manager === 'templates' ? p.t('templatesHint') : p.t(manager)}
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
            <details className={css.projectPicker} open={!view.project}>
              <summary>{projects.find(project => project.id === view.project)?.name || p.t('chooseProjectHint')}</summary>
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
            </details>
          </div>
          <section className={css.historyArea}>
            <small className={css.historyLabel}>{p.t('taskHistory')}</small>
            <form className={css.searchRow} onSubmit={(event) => { event.preventDefault(); void p.read(query) }}>
              <Input
                placeholder={p.t('search')}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setOffset(0)
                }}
              />
              <Action t={p.t} icon={<IconSearchOutline16 />} label={p.t('search')} disabled={!view.project} run={() => p.read(query)}>
                {p.t('search')}
              </Action>
            </form>
            <div className={css.sessionList}>
              {!sessions.length && <p className={css.subtitle}>{p.t('noHistory')}</p>}
              {sessions.map(session => <HistoryItem key={session.id} {...p} session={session} query={query} onRemoved={async () => {
                if (view.session === session.id) { p.actions.session(''); p.monitor(false) }
                const remaining = await p.read(query) as Session[]
                if (!remaining.length && offset > 0) {
                  setOffset(Math.max(0, offset - 30))
                  await p.read(base + '/sessions?search=' + encodeURIComponent(search) + '&offset=' + String(Math.max(0, offset - 30)) + '&limit=30')
                }
                await p.refresh()
              }} />)}
            </div>
            {(offset > 0 || sessions.length >= 30) && <div className={css.row}>
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
            </div>}
          </section>
          <footer>
            <Button icon={<IconSettingsOutline16 />} variant="ghost" onClick={() =>{  p.actions.manager('models') }}>{p.t('models')}</Button>
            <span title={domain.actor}>{domain.actor}</span>
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
  const hasPrompt = (history?.events ?? []).some(event => event.type === 'user/message' &&
    !z.object({ source: z.object({ kind: z.literal('data-agent-context') }) }).safeParse(event.data).success)
  const [title, setTitle] = useState('')
  useEffect(() => { if (!view.session || !domain.authenticated) p.monitor(false) }, [view.session, domain.authenticated, p.monitor])
  const transcript = useRef<HTMLDivElement>(null),
    followTail = useRef(true)
  useEffect(() => {
    followTail.current = true
  }, [view.session])
  useEffect(() => {
    if (followTail.current && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight
  }, [view.session, history?.events.length])
  const failures = Object.entries(domain.errors).filter(
    ([path, error]) =>
      error &&
      (path === '/v1/data/projects' ||
        path === base + '/workbench' ||
        path.startsWith(base + '/sessions/' + view.session + '/')),
  )
  return (
    <main className={[css.conversation, !view.session && domain.authenticated ? css.landing : ''].join(' ')} data-testid="data-conversation">
      {(view.session || !domain.authenticated || failures.length > 0 || !domain.online) && <header>
        <div>
          <small>{p.t('sessions')}</small>
          <h2>{session?.title || session?.input.goal || p.t('title')}</h2>
        </div>
        <span className={failures.length || !domain.online ? css.offline : css.online}>
          {p.t(failures.length || !domain.online ? 'offline' : 'ready')}
        </span>
        {view.session && <Button onClick={() =>{  p.monitor(true) }}>{p.t('monitorOpen')}</Button>}
      </header>}
      {!domain.authenticated ? (
        <div className={css.empty}>{p.t('credential')}</div>
      ) : !view.session ? (
        <NewSession {...p} key={view.project} />
      ) : (
        <>
          <details className={css.sessionOptions}>
            <summary>{p.t('sessionOptions')}</summary>
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
          </details>
          <div
            className={css.transcript}
            ref={transcript}
            onScroll={() => {
              const element = transcript.current
              if (element)
                followTail.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
            }}
          >
            {session && !hasPrompt && (
              <section className={css.userEvent}>
                <small>{p.t('you')}</small>
                <p>{session.input.goal}</p>
                {!(history?.events ?? []).some(
                  event => event.type === 'assistant/message' || event.type === 'tool/call',
                ) && (
                  <>
                    <p>{p.t('submittedHint')}</p>
                    <Action
                      t={p.t}
                      disabled={history?.activity === 'working'}
                      run={async () => {
                        await p.command(base + '/sessions/' + view.session + '/messages', {
                          text: p.t('startMessage'),
                          wait_for_idle: false,
                        })
                        await p.refresh()
                      }}
                    >
                      {p.t('startAnalysis')}
                    </Action>
                  </>
                )}
              </section>
            )}
            {failures.map(([path, error]) => (
              <p key={path} role="alert" className={css.error}>
                {error}
              </p>
            ))}
            {(history?.events ?? []).filter(event => !event.type.startsWith('tool/')).slice(-200).map(event => (
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
  if (event.type === 'assistant/message' && !text) return null
  const failure = z
    .object({ reason: z.object({ kind: z.literal('error'), error: z.object({ message: z.string() }) }) })
    .safeParse(object)
  return (
    <article className={event.type === 'user/message' ? css.userEvent : css.event}>
      <small>{t(event.type === 'user/message' ? 'you' : 'assistant')}</small>
      {failure.success && (
        <p role="alert" className={css.error}>
          {failure.data.reason.error.message}
        </p>
      )}
      {event.type.startsWith('tool/') ? (
        <details>
          <summary>{t('toolDetails')}</summary>
          <pre>{text || JSON.stringify(event.data, null, 2)}</pre>
        </details>
      ) : text ? (
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
    [text, setText] = useState(''),
    domain = p.useDomain(value => value)
  const working = (domain.cache['/v1/data/' + view.project + '/sessions/' + view.session + '/history'] as History | undefined)?.activity === 'working'
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
        primary
        icon={<IconSendOutline14 />}
        label={p.t('send')}
        disabled={!text.trim() || working}
        run={async () => {
          await p.command('/v1/data/' + view.project + '/sessions/' + view.session + '/messages', {
            text,
            wait_for_idle: false,
          })
          setText('')
          await p.refresh()
        }}
      >
        {p.t('send')}
      </Action>
      {working && <small role="status">{p.t('thinking')}</small>}
      {working && <Action t={p.t} run={() => p.command('/v1/data/' + view.project + '/sessions/' + view.session + '/cancel', {})}>{p.t('cancelChat')}</Action>}
    </form>
  )
}
function HistoryItem(p: Surface & { session: Session; query: string; onRemoved(): Promise<void> }) {
  const view = p.useStore(value => value)
  const [editing, setEditing] = useState(false), [deleting, setDeleting] = useState(false), [title, setTitle] = useState('')
  const path = '/v1/data/' + view.project + '/sessions/' + p.session.id
  return <div className={css.historyItem} data-testid="history-item">
    <button type="button" className={p.session.id === view.session ? css.selected : css.session} onClick={() => { p.actions.session(p.session.id); void p.refresh() }}>
      <strong>{p.session.title || p.session.input.goal}</strong>
      <small>{new Date(p.session.updated_at).toLocaleDateString()} · {p.session.status}</small>
    </button>
    <div className={css.historyActions}>
      <Button className={css.iconButton} aria-label={p.t('rename')} title={p.t('rename')} variant="ghost" onClick={() => { setTitle(p.session.title || p.session.input.goal); setEditing(true); setDeleting(false) }}><IconEditOutline16 /></Button>
      <Button className={[css.dangerButton, css.iconButton].join(' ')} aria-label={p.t('deleteHistory')} title={p.t('deleteHistory')} variant="ghost" onClick={() => { setDeleting(true); setEditing(false) }}><IconTrashOutline16 /></Button>
    </div>
    {editing && <div className={css.stack}>
      <Input aria-label={p.t('taskName')} maxLength={256} value={title} onChange={(event) => { setTitle(event.target.value) }} />
      <div className={css.row}><Action t={p.t} disabled={!title.trim()} run={async () => { await p.command(path + '/rename', { title: title.trim() }); setEditing(false); await p.read(p.query); await p.refresh() }}>{p.t('saveName')}</Action><Button onClick={() => { setEditing(false) }}>{p.t('dismissEdit')}</Button></div>
    </div>}
    {deleting && <div className={css.stack} role="group" aria-label={p.t('deleteHistory')}>
      <small>{p.t('deleteHistoryHint')}</small>
      <div className={css.row}><Action t={p.t} run={async () => { await p.command(path + '/delete', {}); await p.onRemoved() }}>{p.t('confirmDelete')}</Action><Button onClick={() => { setDeleting(false) }}>{p.t('dismissEdit')}</Button></div>
    </div>}
  </div>
}

function NewSession(p: Surface) {
  const view = p.useStore(value => value),
    domain = p.useDomain(value => value),
    base = '/v1/data/' + view.project,
    registry = domain.cache[base + '/workbench'] as Registry | undefined
  const [keywords, setKeywords] = useState(''), [generating, setGenerating] = useState(false),
    [goal, setGoal] = useState(''),
    [skillIds, setSkillIds] = useState(''),
    [scope, setScope] = useState('undefined'),
    [task, setTask] = useState(true),
    [model, setModel] = useState<{ provider: string; model: string } | undefined>()
  const rows = z
    .array(
      z.object({
        dataset_id: z.string().nullable(),
        dataset_digest: z.string().nullable(),
        filename: z.string(),
        status: z.string(),
      }),
    )
    .parse(Object.entries(domain.cache)
      .filter(([path]) => path === base + '/datasets' || path.startsWith(base + '/datasets?'))
      .flatMap(([, value]) => z.array(z.unknown()).parse(value)))
  const dataset = view.dataset || ''
  const goalInput = useRef<HTMLTextAreaElement>(null)
  return (
    <section className={css.newSession}>
      <div className={css.welcomeBlock}>
        <span className={css.heroMark} aria-hidden="true">{p.t('mark')}</span>
        <h1>{p.t('welcome')}</h1>
        <p className={css.subtitle}>{p.t(view.project ? 'welcomeHint' : 'chooseProjectHint')}</p>
      </div>
      <div className={css.goalComposer}>
        <textarea
          ref={goalInput}
          aria-label={p.t('goal')}
          disabled={generating}
          placeholder={p.t('goalPlaceholder')}
          value={goal}
          onChange={(event) => { setGoal(event.target.value) }}
        />
        <div className={css.goalToolbar}>
          <Button className={css.attachButton} icon={<IconDatabaseOutline16 />} disabled={!view.project} onClick={() => { p.actions.manager('attach') }}>
            {p.t('attachData')}
          </Button>
          {dataset && <div className={css.mountedDataset}>
            <Button variant="ghost" title={rows.find(row => row.dataset_id === dataset)?.filename} onClick={() => { p.actions.manager('attach') }}>
              <IconDatabaseOutline16 />{rows.find(row => row.dataset_id === dataset)?.filename ?? p.t('attachedData')}
            </Button>
            <Button variant="ghost" className={css.iconButton} aria-label={p.t('detachData')} onClick={() => { p.actions.dataset('') }}><IconCloseOutline16 /></Button>
          </div>}
          <Action
            t={p.t}
            primary
            icon={<IconSendOutline14 />}
            label={p.t('startTask')}
            disabled={
              !rows.some(row => row.dataset_id === dataset && row.status === 'ready') ||
          generating || !goal.trim() ||
          !registry?.runtime ||
          registry.role === 'viewer'
            }
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
                  ...(model ? { model } : {}),
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
              await p.command(base + '/sessions/' + session.session_id + '/rename', { title: goal.trim().slice(0, 48) })
              p.actions.session(session.session_id)
              await p.refresh()
              await p.command(base + '/sessions/' + session.session_id + '/messages', { text: goal, wait_for_idle: false })
              await p.refresh()
            }}
          >
            {p.t('startTask')}
          </Action>
        </div>
      </div>
      <small className={css.startHint}>{p.t(!view.project ? 'chooseProjectHint' : !dataset ? 'nextUpload' : 'reviewBeforeRun')}</small>
      <div className={css.suggestions} aria-label={p.t('suggestedTasks')}>
        {(['qualityPrompt', 'cleanPrompt', 'featurePrompt'] as const).map((prompt, index) => (
          <Button key={prompt} variant="ghost" disabled={generating} onClick={() => { setGoal(p.t(prompt)); goalInput.current?.focus() }}>
            <span className={css.suggestionIcon} aria-hidden="true">{index === 0 ? <IconDataOutline16 /> : index === 1 ? <IconEnhanceOutline16 /> : <IconBranchOutline16 />}</span>
            {p.t(prompt === 'qualityPrompt' ? 'qualitySuggestion' : prompt === 'cleanPrompt' ? 'cleanSuggestion' : 'featureSuggestion')}
          </Button>
        ))}
      </div>
      <div className={css.landingOptions}>
        <details className={css.advanced}>
          <summary>{p.t('generateGoal')}</summary>
          <div className={css.goalActions}>
            <Input aria-label={p.t('goalKeywords')} placeholder={p.t('goalKeywordsHint')} maxLength={1000} value={keywords} disabled={generating} onChange={(event) => { setKeywords(event.target.value) }} />
            <Action t={p.t} disabled={generating || !view.project} run={async () => {
              setGenerating(true)
              try {
                const result = z.object({ goal: z.string().min(1) }).parse(await p.command(base + '/goals', { keywords: keywords.trim(), language: p.t('goalLanguage'), ...(model ? { model } : {}) }))
                setGoal(result.goal)
              } catch {
                throw new Error(p.t('goalFailed'))
              } finally { setGenerating(false) }
            }}>{p.t(keywords.trim() ? 'generateFromKeywords' : 'generateGoal')}</Action>
          </div>
          <small className={css.subtitle}>{p.t('goalGenerationHint')}</small>
        </details>
        <details className={css.advanced}>
          <summary>{p.t('advanced')}</summary>
          <ModelChoice {...p} value={model} onChange={setModel} />
          <fieldset className={css.skillChoices}>
            <legend>{p.t('skills')}</legend>
            {((domain.cache[base + '/skills'] ?? []) as { id: string; default_version: string | null }[])
              .filter(skill => skill.default_version)
              .map(skill => (
                <label key={skill.id}>
                  <input
                    type="checkbox"
                    checked={skillIds.split(',').includes(skill.id)}
                    onChange={(event) => {
                      const ids = skillIds
                        .split(',')
                        .filter(Boolean)
                        .filter(id => id !== skill.id)
                      if (event.target.checked) ids.push(skill.id)
                      setSkillIds(ids.join(','))
                    }}
                  />
                  {skill.id}
                </label>
              ))}
            <small>{p.t('noSkillNeeded')}</small>
          </fieldset>
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
        </details>      </div>
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
            p.monitor(true)
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
  if (!view.monitorOpen) return null
  if (!domain.authenticated)
    return <aside className={css.rightbar} style={{ width: p.canShow ? p.width : Math.min(360, p.viewportWidth) }} data-testid="data-rightbar" />
  return (
    <aside className={css.rightbar} style={{ width: p.canShow ? p.width : Math.min(360, p.viewportWidth) }} data-testid="data-rightbar">
      <header>
        <strong>{p.t('taskMonitor')}</strong>
        <Button
          variant="ghost"
          className={css.iconButton}
          aria-label={p.t('saveColumns')}
          title={p.t('saveColumns')}
          onClick={() => {
            p.saveColumns(p.width)
          }}
        >
          <IconPanelLeftOutline16 />
        </Button>
        <Button className={css.iconButton} aria-label={p.t('monitorClose')} title={p.t('monitorClose')} variant="ghost" onClick={() =>{  p.monitor(false) }}><IconCloseOutline16 /></Button>
      </header>
      <div className={css.tabs}>
        {(['flow', 'status', 'context'] as const).map(tab => (
          <Button
            key={tab}
            variant="ghost"
            className={css.monitorTab}
            aria-pressed={view.tab === tab}
            icon={tab === 'flow' ? <IconBranchOutline16 /> : tab === 'status' ? <IconDataOutline16 /> : <IconContextInjectionOutline16 />}
            onClick={() => {
              p.actions.tab(tab)
            }}
          >
            {p.t(tab === 'flow' ? 'codeTab' : tab === 'status' ? 'artifacts' : 'contextTab')}
          </Button>
        ))}
      </div>
      {!!navigation?.runs.length && (
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
            {navigation.runs.map(row => (
              <option key={row.id} value={row.id}>
                {row.stage ?? p.t('currentRun')} · {row.status} · {row.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
      )}
      {view.tab === 'context' ? (
        <div className={css.scroll}>
          <p className={css.subtitle}>{p.t('contextHint')}</p>
          {session && <section className={css.card}><strong>{p.t('goal')}</strong><p>{session.input.goal}</p><small>{p.t('dataset')}</small><code>{session.input.dataset.artifact_id}</code><small>{p.t('modelSelection')}</small><p>{session.model_id} · {session.provider}</p><details><summary>{p.t('raw')}</summary><pre>{JSON.stringify(session.input, null, 2)}</pre></details></section>}
          {id && <details className={css.card}><summary>{p.t('runIdentity')}</summary><pre>{JSON.stringify(navigation?.runs.find(row => row.id === id), null, 2)}</pre></details>}
          <details className={css.card}><summary>{p.t('executionControls')}</summary>{run && <RunPanel {...p} run={run} task={task} mode="execution" />}</details>
        </div>
      ) : view.tab === 'flow' ? (
        <div className={css.scroll}>
          <p className={css.subtitle}>{p.t('codeHint')}</p>
          <details className={css.card}><summary>{p.t('workflowDefinition')}</summary><pre>{JSON.stringify(navigation?.runs.find(row => row.id === id)?.snapshot ?? view.drafts[view.session]?.workflow ?? {}, null, 2)}</pre></details>
          <details className={css.card}><summary>{p.t('flow')}</summary>
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
          </details>
          <details className={css.card}><summary>{p.t('toolRecords')}</summary>{((domain.cache[base + '/sessions/' + view.session + '/history'] as History | undefined)?.events ?? []).filter(event => event.type.startsWith('tool/')).slice(-200).map(event => <EventCard key={event.seq} event={event} t={p.t} />)}</details>
        </div>
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
            <RunPanel {...p} key={run.run_id} run={run} task={task} mode="artifacts" />
          ) : (
            <div className={css.empty}>{p.t(view.session ? 'nextDiscuss' : 'nextGoal')}</div>
          )}
        </div>
      )}
    </aside>
  )
}
function RunPanel(p: Surface & { run: Run; task: Task | undefined; mode: 'artifacts' | 'execution' }) {
  const view = p.useStore(value => value),
    [scope, setScope] = useState('all'),
    [node, setNode] = useState(''),
    [reuse, setReuse] = useState(true),
    run = p.run,
    domain = p.useDomain(value => value),
    base = '/v1/data/' + view.project
  return (
    <>
      {p.mode === 'execution' && <>
        <section className={css.card}>
          <strong>{run.status}</strong>
          <details>
            <summary>{p.t('raw')}</summary>
            <code>{run.run_id}</code>
          </details>
          <small>
            {p.t('taskRevision')}: {p.task?.revision ?? '—'} · {p.task?.status}
          </small>
          <details>
            <summary>{p.t('executionControls')}</summary>
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
          </details>
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
      </>}
      {p.mode === 'artifacts' && !run.artifacts.length && <p className={css.subtitle}>{p.t('noArtifacts')}</p>}
      {p.mode === 'artifacts' && run.nodes.filter(node => node.status === 'computed_waiting_approval').map(node => <Candidate key={node.job_id} {...p} job={node.job_id} />)}
      {p.mode === 'artifacts' && run.artifacts.map(artifact => (
        <section className={css.card} key={artifact.id}>
          <strong>{artifact.kind}</strong>
          <details>
            <summary>{p.t('raw')}</summary>
            <code>{artifact.id}</code>
          </details>
          <small>{artifact.bytes} B</small>
          {artifact.kind === 'ReportRef' && (
            <>
              <Action t={p.t} primary run={() => p.read(base + '/artifacts/' + artifact.id + '/report')}>
                {p.t('viewReport')}
              </Action>
              <QualityReport value={domain.cache[base + '/artifacts/' + artifact.id + '/report']} t={p.t} />
            </>
          )}
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
function QualityReport({ value, t }: { value: unknown; t: Surface['t'] }) {
  if (value === undefined) return null
  const report = z
    .object({
      scope: z.string(),
      rows: z.number(),
      columns: z.number(),
      duplicate_rows: z.number(),
      fields: z.record(
        z.string(),
        z.object({
          nulls: z.number(),
          unique: z.number(),
          top: z.array(z.object({ count: z.number() }).catchall(z.json())).optional(),
        }),
      ),
    })
    .safeParse(value)
  if (!report.success)
    return (
      <details>
        <summary>{t('raw')}</summary>
        <pre>{JSON.stringify(value, null, 2)}</pre>
      </details>
    )
  return (
    <section className={css.qualityReport}>
      <p>
        {t('reportRows')}: {report.data.rows} · {t('reportColumns')}: {report.data.columns}
      </p>
      <p>
        {t('reportDuplicates')}: {report.data.duplicate_rows}
      </p>
      <small>
        {t('reportScope')}: {report.data.scope}
      </small>
      <table>
        <thead>
          <tr>
            <th>{t('fieldName')}</th>
            <th>{t('fieldNulls')}</th>
            <th>{t('fieldUnique')}</th>
            <th>{t('fieldPlaceholder')}</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(report.data.fields).map(([name, field]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{field.nulls}</td>
              <td>{field.unique}</td>
              <td>{field.top?.find(item => item[name] === '?')?.count.toString() ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
/** Manager closure preserves all three surface selections and workflow drafts. */
export function Manager(p: Surface) {
  const view = p.useStore(value => value),
    domain = p.useDomain(value => value)
  return (
    <Modal
      open={view.manager === 'models' || (domain.authenticated && view.manager !== null)}
      onClose={() => {
        p.actions.manager(null)
      }}
      title={view.manager ? p.t(view.manager) : ''}
      closeLabel={p.t('close')}
      description={p.t(view.manager === 'attach' ? 'mountHint' : view.manager === 'templates' ? 'templatesHint' : 'retained')}
      className={[css.manager, view.manager === 'attach' ? css.mountModal : ''].join(' ')}
    >
      <div className={css.managerContent}>
        {Object.entries(domain.errors)
          .filter(([path, error]) => error && path.startsWith('/v1/data/' + view.project + '/'))
          .map(([path, error]) => (
            <p key={path} role="alert" className={css.error}>
              {error}
            </p>
          ))}
        {view.manager === 'attach' ? (
          <DatasetMount {...p} key={view.project} />
        ) : view.manager === 'models' ? (
          <ModelConfiguration {...p} />
        ) : view.manager === 'data' ? (
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
