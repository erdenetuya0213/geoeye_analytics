import { useEffect, useRef } from 'react'

export function RowSelectionCheckbox({ checked, mixed = false, disabled = false, label, onChange }: {
  checked: boolean; mixed?: boolean; disabled?: boolean; label: string; onChange: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed }, [mixed])
  return <input ref={ref} type="checkbox" checked={checked} aria-checked={mixed ? 'mixed' : checked} disabled={disabled} aria-label={label} title={label} onChange={onChange} />
}
