import type { PaginatedResult } from '../core/paginate.js';
import type { AttachInteractionsOptions, InteractionController } from './types.js';
export declare function attachInteractions(result: PaginatedResult, host: HTMLElement, options?: AttachInteractionsOptions): InteractionController;
