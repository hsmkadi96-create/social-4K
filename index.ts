import { z } from 'zod';
export const RegisterSchema=z.object({email:z.string().email(),password:z.string().min(8),name:z.string().max(80).optional()});
export const LoginSchema=z.object({email:z.string().email(),password:z.string().min(1)});
export const JobSchema=z.object({fileKey:z.string(),originalName:z.string(),inputBytes:z.number().positive()});
export type Role='USER'|'ADMIN';
