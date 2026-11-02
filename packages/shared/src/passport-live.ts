import { z } from 'zod';
import { makePassportBookSchema } from './passport-core';
export * from './passport-core';
export const LivePassportBookSchema = makePassportBookSchema(z.literal('live'));
export type LivePassportBook = z.infer<typeof LivePassportBookSchema>;
