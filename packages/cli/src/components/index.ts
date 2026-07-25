/**
 * CLI Components Index
 */

import { Table, colors } from './table.js'
import { red, green, yellow, cyan, bold, dim } from './colors.js'

export { Table, colors } from './table.js'
export { red, green, yellow, cyan, bold, dim } from './colors.js'
export { Box, box } from './box.js'

// Color and icon helpers
export const info = (msg: string) => `${cyan('ℹ')} ${msg}`;
export const success = (msg: string) => `${green('✓')} ${msg}`;
export const warning = (msg: string) => `${yellow('⚠')} ${msg}`;
export const error = (msg: string) => `${red('✗')} ${msg}`;

export { ProgressSpinner, ProgressBar } from './progress.js'
export { Terminal, createTerminal } from './terminal.js'
