// [LAW:behavior-not-structure] Pins recordRemark's loud-failure contract: persisting
// a remark to a generation row that does not exist (a 0-row UPDATE) THROWS rather
// than silently succeeding — the exact silent drop the writer exists to prevent. Runs
// against real D1 (workers project), so the 0-changes path is exercised by real SQL,
// not a mock.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { recordRemark } from '~/db/remark'
import { spoke } from '~/lib/voice'
import { PostId } from '~/lib/domain'

describe('recordRemark', () => {
  it('throws when the target generation row does not exist (0-row UPDATE)', async () => {
    // No row with this id exists → the UPDATE succeeds but changes 0 rows. A silent
    // success here would drop the remark and let it read downstream as "no utterance";
    // the writer must fail loud instead.
    await expect(
      recordRemark(env, PostId('does-not-exist-0000'), spoke('a line that lands nowhere')),
    ).rejects.toThrow(/0 rows/)
  })
})
