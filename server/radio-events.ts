import { z } from 'zod';

export const radioEventSchema = z.object({
  eventId: z.string().min(1).max(240),
  deviceId: z.string().min(1).max(100),
  sessionUid: z.string().min(1).max(100),
  sessionLinkId: z.number().int().positive(),
  sessionType: z.string().min(1).max(80),
  messageId: z.string().min(1).max(300),
  status: z.enum(['SELECTED','QUEUED','DEFERRED','SUBMITTED','STARTED','COMPLETED','CANCELLED','EXPIRED','ERROR']),
  text: z.string().max(2000),
  reason: z.string().max(200),
  category: z.enum(['SAFETY','STRATEGY','BATTLE','PACE','CAR','STATUS']),
  lap: z.number().int().min(0).max(1000),
  clientAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
export const radioBatchSchema = z.object({events:z.array(radioEventSchema).min(1).max(50)}).strict();
export type RadioEvent = z.infer<typeof radioEventSchema>;

export const radioQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  device: z.string().max(100).default(''),
  status: z.string().max(30).default(''),
  category: z.string().max(30).default(''),
  lap: z.coerce.number().int().min(-1).max(1000).default(-1),
});
