import { z } from 'zod';
import { makePassportBookSchema } from './passport-core';
export * from './passport-core';
export const PassportBookSchema = makePassportBookSchema(z.enum(['live', 'simulated']));
export type PassportBook = z.infer<typeof PassportBookSchema>;
