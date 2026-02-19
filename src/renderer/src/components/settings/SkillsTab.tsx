import { useState } from 'react'
import { ChevronLeft, Trash2, Store } from 'lucide-react'
import { Switch } from '@renderer/components/ui/switch'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'
import { useSkills } from '@renderer/hooks/useSkills'
import { MarketplaceDialog } from './MarketplaceDialog'

export function SkillsTab() {
  const {
    skills,
    installing,
    error: skillsError,
    installSkill,
    removeSkill,
    toggleSkill
  } = useSkills()
  const [skillUrl, setSkillUrl] = useState('')
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [skillToDelete, setSkillToDelete] = useState<string | null>(null)
  const [marketplaceOpen, setMarketplaceOpen] = useState(false)

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Skills</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Install and manage agent skills from GitHub.
        </p>
      </div>
      <MarketplaceDialog open={marketplaceOpen} onOpenChange={setMarketplaceOpen} />
      <ConfirmDeleteDialog
        open={!!skillToDelete}
        onOpenChange={(open) => !open && setSkillToDelete(null)}
        title="Delete skill"
        itemName={skillToDelete}
        description="Are you sure you want to delete"
        onConfirm={() => {
          if (skillToDelete) {
            removeSkill(skillToDelete)
            if (selectedSkill === skillToDelete) setSelectedSkill(null)
          }
          setSkillToDelete(null)
        }}
      />
      {selectedSkill && skills.find((s) => s.name === selectedSkill) ? (
        (() => {
          const skill = skills.find((s) => s.name === selectedSkill)!
          return (
            <div className="space-y-4">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setSelectedSkill(null)}
              >
                <ChevronLeft className="size-4" />
                Back
              </button>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-medium">{skill.name}</h3>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={skill.enabled}
                        onCheckedChange={(v) => toggleSkill(skill.name, v)}
                      />
                      <span className="text-xs text-muted-foreground">
                        {skill.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-red-500"
                      onClick={() => setSkillToDelete(skill.name)}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
                {skill.description && (
                  <p className="text-sm text-muted-foreground">{skill.description}</p>
                )}
              </div>
            </div>
          )
        })()
      ) : (
        <>
          <button
            type="button"
            className="w-full h-9 rounded-lg border border-border bg-muted text-sm text-muted-foreground hover:text-foreground inline-flex items-center justify-center gap-2"
            onClick={() => setMarketplaceOpen(true)}
          >
            <Store className="size-4" />
            Browse Marketplace
          </button>
          <p className="text-xs text-muted-foreground">
            Add agent skills from GitHub. Paste a URL like
            https://github.com/owner/repo/tree/branch/skills/name
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 h-9 rounded-lg border border-border bg-background text-foreground text-sm px-3"
              placeholder="https://github.com/..."
              value={skillUrl}
              onChange={(e) => setSkillUrl(e.target.value)}
              disabled={!!installing}
            />
            <button
              type="button"
              className="h-9 rounded-lg bg-accent text-accent-foreground px-3 text-sm disabled:opacity-50"
              disabled={!!installing || !skillUrl.trim()}
              onClick={async () => {
                await installSkill(skillUrl.trim())
                setSkillUrl('')
              }}
            >
              {installing ? 'Installing...' : 'Add'}
            </button>
          </div>
          {skillsError && <p className="text-xs text-red-500">{skillsError}</p>}
          {skills.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {skills.map((skill) => (
                <button
                  key={skill.name}
                  type="button"
                  className={`rounded-lg border border-border bg-muted p-3 text-left hover:border-foreground/20 transition-colors ${!skill.enabled ? 'opacity-60' : ''}`}
                  onClick={() => setSelectedSkill(skill.name)}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`size-1.5 rounded-full shrink-0 ${skill.enabled ? 'bg-green-500' : 'bg-foreground/20'}`}
                    />
                    <p className="text-sm font-medium truncate">{skill.name}</p>
                  </div>
                  {skill.description && (
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
                      {skill.description}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
          {skills.length === 0 && !skillsError && (
            <p className="text-sm text-muted-foreground text-center py-6">
              No skills installed yet.
            </p>
          )}
        </>
      )}
    </div>
  )
}
