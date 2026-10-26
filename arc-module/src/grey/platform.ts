export interface PlatformContext { companyId: string; companyName: string }
export function getPlatformContext(): PlatformContext | null {
  if (typeof document === 'undefined') return null
  const context = document.getElementById('grey-company-context')
  if (!context?.textContent) return null
  try {
    const value = JSON.parse(context.textContent) as PlatformContext
    return typeof value.companyId === 'string' && typeof value.companyName === 'string' ? value : null
  } catch { return null }
}
