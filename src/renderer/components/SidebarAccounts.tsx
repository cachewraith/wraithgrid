// The sidebar's account list: one level of folders, and drag an account onto a folder
// (or onto the list itself, for the top level) to move it. Right-click a folder to edit it.
import { useRef, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent
} from '@dnd-kit/core'
import { ICON_COLORS } from '@shared/icons'
import type { Account, AccountFolder } from '@shared/types'
import { useActions, useApp } from '../app/services'
import { AccountIcon, Avatar } from './AccountIcon'
import { ContextMenu, menuPoint, type MenuPoint } from './ContextMenu'
import { IconPopover } from './IconPicker'
import { IconClose, IconFolder, IconPlus, IconRename, IconSun, IconTrash } from './icons'

const ROOT = 'folder:root'
// The zone under the pointer; if none, the one the dragged row overlaps.
const pointerThenRect: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length ? hits : rectIntersection(args)
}
const folderDropId = (id: string): string => `folder:${id}`
const accountDragId = (id: string): string => `acc:${id}`

function AccountRow({ account }: { account: Account }) {
  const { setNodeRef, listeners, attributes, isDragging, transform } = useDraggable({
    id: accountDragId(account.id)
  })
  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 5 }
    : undefined
  return (
    <div
      ref={setNodeRef}
      className={`acc-row drag${isDragging ? ' dragging' : ''}`}
      style={style}
      title={`Drag ${account.name} into a folder`}
      {...listeners}
      {...attributes}
      aria-roledescription="draggable account"
    >
      <AccountIcon account={account} />
      <span className="nm">{account.name}</span>
      {account.signedIn ? null : <span className="acc-sub warn">login needed</span>}
    </div>
  )
}

function FolderRow({ folder, accounts }: { folder: AccountFolder; accounts: Account[] }) {
  const actions = useActions()
  const { setNodeRef, isOver } = useDroppable({ id: folderDropId(folder.id) })
  const folderCount = useApp((s) => s.config.accountFolders.length)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(folder.name)
  const [menu, setMenu] = useState<MenuPoint | null>(null)
  const [iconAt, setIconAt] = useState<{ top: number; left: number } | null>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const save = (): void => {
    actions.renameFolder(folder.id, name)
    setRenaming(false)
  }
  const startRename = (): void => {
    setName(folder.name)
    setRenaming(true)
  }

  return (
    <div ref={setNodeRef} className={`fold${isOver ? ' over' : ''}`}>
      <div
        ref={headRef}
        className="fold-hd"
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu(menuPoint(e))
        }}
      >
        <button
          className="fold-tg"
          aria-expanded={!folder.collapsed}
          aria-label={`${folder.collapsed ? 'Expand' : 'Collapse'} ${folder.name}`}
          onClick={() => actions.toggleFolder(folder.id)}
        >
          <span className={`chev${folder.collapsed ? '' : ' open'}`} aria-hidden="true">
            ›
          </span>
        </button>
        <span className="fold-ic">
          {folder.icon ? (
            <Avatar icon={folder.icon} name={folder.name} color={folder.color || 'var(--fa)'} />
          ) : (
            <span style={{ color: folder.color || 'var(--fa)', display: 'flex' }}>
              <IconFolder small />
            </span>
          )}
        </span>
        {renaming ? (
          <input
            className="inpt sans fold-in"
            value={name}
            maxLength={64}
            aria-label="Folder name"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') {
                e.stopPropagation()
                setName(folder.name)
                setRenaming(false)
              }
            }}
          />
        ) : (
          <span
            className="fold-nm"
            title="Double-click or right-click to rename"
            onDoubleClick={startRename}
          >
            {folder.name}
          </span>
        )}
        <span className="cnt">{accounts.length}</span>
        <button
          className="icon-btn sm fold-rm"
          aria-label={`Delete folder ${folder.name} (its accounts stay)`}
          title="Delete folder (its accounts stay)"
          onClick={() => actions.deleteFolder(folder.id)}
        >
          <IconClose small />
        </button>
      </div>
      {menu ? (
        <ContextMenu
          at={menu}
          label={`Folder ${folder.name}`}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Rename', icon: <IconRename small />, onSelect: startRename },
            {
              label: 'Change icon',
              icon: <IconSun small />,
              onSelect: () => {
                const r = headRef.current?.getBoundingClientRect()
                if (r) setIconAt({ top: r.bottom + 6, left: r.left + 8 })
              }
            },
            {
              label: folder.collapsed ? 'Expand' : 'Collapse',
              icon: <IconFolder small />,
              onSelect: () => actions.toggleFolder(folder.id)
            },
            {
              label: 'New folder',
              icon: <IconPlus small />,
              disabled: folderCount >= 32,
              onSelect: () => void actions.createFolder(`Folder ${folderCount + 1}`)
            },
            {
              label: 'Delete folder (accounts stay)',
              icon: <IconTrash small />,
              danger: true,
              onSelect: () => actions.deleteFolder(folder.id)
            }
          ]}
        />
      ) : null}
      {iconAt ? (
        <IconPopover
          at={iconAt}
          icon={folder.icon}
          color={folder.color}
          colors={ICON_COLORS}
          name={folder.name}
          onPick={(c, done) => {
            actions.setFolderIcon(folder.id, c.icon, c.color)
            if (done) setIconAt(null)
          }}
          onClose={() => setIconAt(null)}
        />
      ) : null}
      {folder.collapsed ? null : (
        <div className="fold-bd">
          {accounts.length === 0 ? <div className="side-empty">Drop accounts here.</div> : null}
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} />
          ))}
        </div>
      )}
    </div>
  )
}

/** The top level: dropping here takes an account out of its folder. */
function RootZone({ accounts, hint }: { accounts: Account[]; hint: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: ROOT })
  return (
    <div ref={setNodeRef} className={`acc-root${isOver ? ' over' : ''}`}>
      {accounts.map((a) => (
        <AccountRow key={a.id} account={a} />
      ))}
      {hint ? (
        <div className="side-empty">Drop here to take an account out of its folder.</div>
      ) : null}
    </div>
  )
}

export function SidebarAccounts() {
  const actions = useActions()
  const accounts = useApp((s) => s.config.accounts)
  const folders = useApp((s) => s.config.accountFolders)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const onDragEnd = (e: DragEndEvent): void => {
    const active = String(e.active.id)
    const over = e.over ? String(e.over.id) : null
    if (!over || !active.startsWith('acc:')) return
    const accountId = active.slice(4)
    actions.moveAccountToFolder(accountId, over === ROOT ? null : over.slice('folder:'.length))
  }

  const loose = accounts.filter((a) => !a.folderId)

  return (
    <div className="sec">
      <div className="sec-hd">
        <span>Accounts</span>
        <span style={{ display: 'flex', gap: 2 }}>
          <button
            onClick={() => actions.createFolder(`Folder ${folders.length + 1}`)}
            title="New folder"
            aria-label="New folder"
            disabled={folders.length >= 32}
          >
            <IconPlus small />
          </button>
          <button onClick={() => actions.setView('accounts')}>Manage</button>
        </span>
      </div>
      {accounts.length === 0 ? <div className="side-empty">No accounts yet.</div> : null}
      <DndContext sensors={sensors} collisionDetection={pointerThenRect} onDragEnd={onDragEnd}>
        {folders.map((f) => (
          <FolderRow key={f.id} folder={f} accounts={accounts.filter((a) => a.folderId === f.id)} />
        ))}
        <RootZone
          accounts={loose}
          hint={folders.length > 0 && loose.length === 0 && accounts.length > 0}
        />
      </DndContext>
    </div>
  )
}
