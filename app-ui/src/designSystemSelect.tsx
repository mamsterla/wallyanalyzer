import { FormControl, InputLabel, MenuItem, Select, type SelectChangeEvent } from '@mui/material';
import type { ReactNode } from 'react';

export interface WallySelectOption { value: string; label: ReactNode; disabled?: boolean; }

export function WallySelect({ label, value, options, onChange, disabled, minWidth }: { label: string; value: string; options: WallySelectOption[]; onChange: (value: string) => void; disabled?: boolean; minWidth?: number }) {
  return <FormControl fullWidth={!minWidth} disabled={disabled} sx={minWidth ? { minWidth } : undefined}>
    <InputLabel>{label}</InputLabel>
    <Select label={label} value={value} onChange={(event: SelectChangeEvent<string>) => onChange(event.target.value)} MenuProps={{ PaperProps: { className: 'wally-select-menu' } }}>
      {options.map(option => <MenuItem key={option.value || '__empty'} value={option.value} disabled={option.disabled}>{option.label}</MenuItem>)}
    </Select>
  </FormControl>;
}
