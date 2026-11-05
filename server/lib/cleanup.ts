import { cleanupLabeller } from 'vite-hub/presets/labeller'
import labeller from '../agents/labeller'
import { settings } from './settings'

export async function cleanup() {
  return cleanupLabeller(labeller, { apply: settings.LABELLER_CLEANUP_ENABLED })
}
