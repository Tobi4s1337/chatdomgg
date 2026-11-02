import { LivePassportBookSchema, type LivePassportBook } from '@chatdom/shared/passport/live';
import { readPassportReplyWith, type PassportReply } from './contracts-core';
/** The live surface accepts only a live book; all other reply validation is shared. */
export function readLivePassportReply(value: unknown): PassportReply | undefined {
  return readPassportReplyWith(value, (book): LivePassportBook | undefined => {
    const parsed = LivePassportBookSchema.safeParse(book);
    return parsed.success ? parsed.data : undefined;
  });
}
