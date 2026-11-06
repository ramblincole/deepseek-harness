import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ForgeRepository } from '@deepseek-ai/dsh-experimental-forge'

/** Opaque key of one pull or merge request: `<forge>:<host>/<owner>/<name>#<number>`, lowercase. */
export type PrKey = Branded<'ReviewPrKey'>

/** What happened to a change request, independent of the code host. */
export type ReviewEventKind = 'opened' | 'updated' | 'reopened' | 'ended'

/** One normalized, already-filtered-by-shape webhook event. */
export interface ReviewEvent {
  readonly kind: ReviewEventKind
  readonly repository: ForgeRepository
  readonly number: number
  readonly title: string
  readonly author: string
  readonly baseRef: string
  readonly baseSha: string
  readonly headSha: string
  /** True when an `ended` event is a merge rather than a close. */
  readonly merged: boolean
  readonly deliveryId: string
  readonly url: string
}

/** Why an event is not reviewed; logged, never posted to the change request. */
export type IgnoredReason =
    | 'unsupported-event' | 'unsupported-action' | 'draft' | 'fork' | 'unknown-project' | 'unprotected-branch'

export interface Ignored { readonly ignored: IgnoredReason }

export type Severity = 'blocker' | 'major' | 'minor' | 'nit'

/** A finding the bot already posted, kept to deduplicate and to update its status. */
export interface PublishedFinding {
  id: string
  path: string
  startLine: number
  endLine: number
  severity: Severity
  title: string
  contentHash: string
  commentId?: string
  threadId?: string
  status: 'open' | 'fixed' | 'withdrawn'
}

/** One new finding from the review Agent. */
export interface NewFinding {
  path: string
  startLine: number
  endLine: number
  side: 'L' | 'R'
  severity: Severity
  title: string
  body: string
  suggestion?: string
}

/** What `submit_review` carries. */
export interface ReviewSubmission {
  summary: string
  assessment: 'ok' | 'concerns' | 'blockers'
  findings: NewFinding[]
  previous: Array<{ id: string; status: 'fixed' | 'still-open' | 'withdrawn' }>
}
