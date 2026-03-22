import { ARCHETYPES, type Archetype } from "../../archetypes";

type ArchetypePresetsCardProps = {
  activeArchetypeId: string | null;
  onSelectArchetype: (archetype: Archetype) => void;
  onQuickLaunchArchetype: (archetype: Archetype) => void;
  isLaunching: boolean;
};

export function ArchetypePresetsCard(props: ArchetypePresetsCardProps) {
  const {
    activeArchetypeId,
    onQuickLaunchArchetype,
    onSelectArchetype,
    isLaunching,
  } = props;

  return (
    <div className="hosted-item">
      <h3>Hero Archetypes</h3>
      <p className="archetype-hint">
        Select an archetype to pre-fill strategy, policy, and trait.
      </p>
      <div className="archetype-grid">
        {ARCHETYPES.map((arch) => (
          <div
            key={arch.id}
            className={`archetype-card${activeArchetypeId === arch.id ? " selected" : ""}`}
          >
            <button
              type="button"
              className="archetype-select"
              onClick={() => onSelectArchetype(arch)}
            >
              <span className="archetype-icon">{arch.icon}</span>
              <span className="archetype-label">{arch.label}</span>
              <span className="archetype-desc">{arch.description}</span>
            </button>
            <div className="archetype-card-actions">
              <button
                type="button"
                className="ghost"
                disabled={isLaunching}
                onClick={() => onQuickLaunchArchetype(arch)}
              >
                Quick Launch
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
