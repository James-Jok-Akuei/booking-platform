import { Platform, Switch, type SwitchProps } from 'react-native';
import { theme } from '../theme';

/**
 * The app's on/off switch: coral when on, a white knob on every platform —
 * the browser build ignores `thumbColor` and needs its own word for it.
 */
export function AppSwitch(props: Omit<SwitchProps, 'trackColor' | 'thumbColor'>) {
  return (
    <Switch
      {...props}
      trackColor={{ true: theme.accent, false: theme.line }}
      thumbColor="#FFFFFF"
      {...(Platform.OS === 'web' ? ({ activeThumbColor: '#FFFFFF' } as object) : {})}
    />
  );
}
