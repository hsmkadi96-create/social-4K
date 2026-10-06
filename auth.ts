import { Injectable,CanActivate,ExecutionContext,UnauthorizedException,createParamDecorator } from '@nestjs/common';
import jwt from 'jsonwebtoken';
export type Claims={sub:string,role:'USER'|'ADMIN'};
@Injectable() export class AuthGuard implements CanActivate{canActivate(ctx:ExecutionContext){const req=ctx.switchToHttp().getRequest();const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))throw new UnauthorizedException();try{req.user=jwt.verify(h.slice(7),process.env.JWT_SECRET!) as Claims;return true}catch{throw new UnauthorizedException()}}}
export const CurrentUser=createParamDecorator((_:unknown,ctx:ExecutionContext)=>ctx.switchToHttp().getRequest().user as Claims);
export function sign(c:Claims){return jwt.sign(c,process.env.JWT_SECRET!,{expiresIn:'7d'});}
