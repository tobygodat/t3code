import { SettingsGroup } from "../../components/settings/SettingsGroup";
import {
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "../../components/settings/settingsLayout";
import { Switch } from "../../components/ui/switch";
import { FORK_STYLE_FEATURES, type ForkStyleGroup } from "./features";
import { setForkStyleFeature, useForkStyleFeature } from "./store";

const GROUPS: ReadonlyArray<readonly [ForkStyleGroup, string]> = [
  ["primitives", "Building blocks"],
  ["motion", "Motion"],
  ["loops", "Ambient animation"],
];

function FeatureRow({ feature }: { feature: (typeof FORK_STYLE_FEATURES)[number] }) {
  const on = useForkStyleFeature(feature.id);
  return (
    <SettingsRow
      id={`fork-style-${feature.id}`}
      title={feature.label}
      description={feature.description}
      resetAction={
        on ? null : (
          <SettingResetButton
            label={feature.label.toLowerCase()}
            onClick={() => setForkStyleFeature(feature.id, true)}
          />
        )
      }
      control={
        <Switch
          checked={on}
          onCheckedChange={(checked) => setForkStyleFeature(feature.id, Boolean(checked))}
          aria-label={feature.label}
        />
      }
    />
  );
}

export function CustomizeSection() {
  return (
    <SettingsSection id="fork-customize" title="Customize" variant="plain">
      <p className="px-3 text-muted-foreground text-xs sm:px-4">
        These apply to the default dark theme. Motion pauses when your system asks for reduced
        motion.
      </p>
      {GROUPS.map(([group, title]) => (
        <div key={group} className="space-y-1.5 pt-2">
          <h3 className="px-3 font-medium text-muted-foreground text-xs sm:px-4">{title}</h3>
          <SettingsGroup>
            {FORK_STYLE_FEATURES.filter((feature) => feature.group === group).map((feature) => (
              <FeatureRow key={feature.id} feature={feature} />
            ))}
          </SettingsGroup>
        </div>
      ))}
    </SettingsSection>
  );
}
