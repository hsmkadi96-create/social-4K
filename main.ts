import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module,Controller,Post,Get,Patch,Body,Param,UseGuards,UnauthorizedException,ForbiddenException } from '@nestjs/common';
import { BullModule,InjectQueue,Processor,WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaClient } from '@pkg/db';
import bcrypt from 'bcryptjs';
import { AuthGuard,CurrentUser,sign } from './auth/auth';
import { S3Client,PutObjectCommand,GetObjectCommand,CreateBucketCommand } from '@aws-sdk/client-s3';
import Stripe from 'stripe';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const db=new PrismaClient();
const s3=new S3Client({region:process.env.S3_REGION||'us-east-1',endpoint:process.env.S3_ENDPOINT,forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY||'',secretAccessKey:process.env.S3_SECRET_KEY||''}});
const bucket=process.env.S3_BUCKET||'patcher';
async function ensureBucket(){try{await s3.send(new CreateBucketCommand({Bucket:bucket}));}catch(e){} try{await s3.send(new PutObjectCommand({Bucket:bucket,Key:'.keep',Body:''}));}catch(e){console.warn('Object storage unavailable:',String(e));}}
const stripe=process.env.STRIPE_SECRET_KEY?new Stripe(process.env.STRIPE_SECRET_KEY):null;

@Controller('auth') class AuthController{
 @Post('register') async register(@Body() b:any){const exists=await db.user.findUnique({where:{email:b.email}});if(exists)throw new ForbiddenException('Email already registered');const hash=await bcrypt.hash(b.password,12);const plan=await db.plan.findUnique({where:{name:'Free'}});if(!plan)throw new Error('Free plan missing');const u=await db.user.create({data:{email:b.email,passwordHash:hash,name:b.name,subscription:{create:{planId:plan.id}}},include:{subscription:{include:{plan:true}}}});return {token:sign({sub:u.id,role:u.role}),user:{id:u.id,email:u.email,name:u.name,role:u.role,plan:u.subscription?.plan.name}}}
 @Post('login') async login(@Body() b:any){const u=await db.user.findUnique({where:{email:b.email},include:{subscription:{include:{plan:true}}}});if(!u||!(await bcrypt.compare(b.password,u.passwordHash))||u.suspended)throw new UnauthorizedException('Invalid credentials');return {token:sign({sub:u.id,role:u.role}),user:{id:u.id,email:u.email,name:u.name,role:u.role,plan:u.subscription?.plan.name}}}
}
@Controller('me') @UseGuards(AuthGuard) class MeController{
 @Get() async me(@CurrentUser() c:any){return db.user.findUnique({where:{id:c.sub},select:{id:true,email:true,name:true,role:true,suspended:true,subscription:{include:{plan:true}}}})}
 @Get('jobs') async jobs(@CurrentUser() c:any){return db.videoJob.findMany({where:{userId:c.sub},orderBy:{createdAt:'desc'},take:50})}
}
@Controller('plans') class PlansController{@Get() list(){return db.plan.findMany({where:{active:true},orderBy:{priceCents:'asc'}})}}
@Controller('billing') @UseGuards(AuthGuard) class BillingController{ @Post('checkout') async checkout(@CurrentUser() c:any,@Body() b:any){if(!stripe)throw new ForbiddenException('Stripe is not configured');const plan=await db.plan.findUnique({where:{id:b.planId}});if(!plan||!plan.active)throw new ForbiddenException('Plan unavailable');const session=await stripe.checkout.sessions.create({mode:'subscription',line_items:[{price_data:{currency:'usd',product_data:{name:plan.name},unit_amount:plan.priceCents,recurring:{interval:plan.interval as any}},quantity:1}],success_url:(process.env.WEB_URL||'http://localhost:3000')+'/dashboard?billing=success',cancel_url:(process.env.WEB_URL||'http://localhost:3000')+'/dashboard?billing=cancel',metadata:{userId:c.sub,planId:plan.id}});return {url:session.url}} }
@Controller('jobs') @UseGuards(AuthGuard) class JobsController{
 constructor(@InjectQueue('video') private q:Queue){}
 @Post('upload-url') async upload(@CurrentUser() c:any,@Body() b:any){const sub=await db.subscription.findUnique({where:{userId:c.sub},include:{plan:true}});if(!sub)throw new ForbiddenException('No subscription');if(b.inputBytes>Number(sub.plan.maxFileBytes))throw new ForbiddenException('File exceeds plan limit');const day=new Date();day.setUTCHours(0,0,0,0);const usage=await db.usageDay.findUnique({where:{userId_day:{userId:c.sub,day}}});if((usage?.jobs||0)>=sub.plan.dailyJobLimit)throw new ForbiddenException('Daily limit reached');const key=`uploads/${c.sub}/${crypto.randomUUID()}-${b.originalName}`;const url=await getSignedUrl(s3,new PutObjectCommand({Bucket:bucket,Key:key,ContentType:b.contentType||'application/octet-stream'}),{expiresIn:900});return {key,url}}
 @Post() async create(@CurrentUser() c:any,@Body() b:any){const sub=await db.subscription.findUnique({where:{userId:c.sub},include:{plan:true}});if(!sub)throw new ForbiddenException();const day=new Date();day.setUTCHours(0,0,0,0);const usage=await db.usageDay.upsert({where:{userId_day:{userId:c.sub,day}},update:{jobs:{increment:1},bytesIn:{increment:BigInt(b.inputBytes)}},create:{userId:c.sub,day,jobs:1,bytesIn:BigInt(b.inputBytes)}});if(usage.jobs>sub.plan.dailyJobLimit){await db.usageDay.update({where:{id:usage.id},data:{jobs:{decrement:1},bytesIn:{decrement:BigInt(b.inputBytes)}}});throw new ForbiddenException('Daily limit reached');}const job=await db.videoJob.create({data:{userId:c.sub,originalName:b.originalName,inputKey:b.fileKey,inputBytes:BigInt(b.inputBytes)}});await this.q.add('process',{jobId:job.id,inputKey:job.inputKey},{priority:sub.plan.priority,removeOnComplete:100,removeOnFail:100});return job}
 @Get(':id/download') async download(@CurrentUser() c:any,@Param('id') id:string){const j=await db.videoJob.findFirst({where:{id,userId:c.sub}});if(!j?.outputKey)throw new ForbiddenException('Output unavailable');return {url:await getSignedUrl(s3,new GetObjectCommand({Bucket:bucket,Key:j.outputKey}),{expiresIn:900})}}
}
@Controller('admin') @UseGuards(AuthGuard) class AdminController{
 private check(c:any){if(c.role!=='ADMIN')throw new ForbiddenException();}
 @Get('stats') async stats(@CurrentUser() c:any){this.check(c);const [users,jobs,active]=await Promise.all([db.user.count(),db.videoJob.count(),db.subscription.count({where:{status:'ACTIVE'}})]);return {users,jobs,activeSubscriptions:active}}
 @Get('users') async users(@CurrentUser() c:any){this.check(c);return db.user.findMany({select:{id:true,email:true,name:true,role:true,suspended:true,createdAt:true,subscription:{include:{plan:true}}},orderBy:{createdAt:'desc'}})}
 @Patch('users/:id') async update(@CurrentUser() c:any,@Param('id') id:string,@Body() b:any){this.check(c);return db.user.update({where:{id},data:{suspended:b.suspended}})}
 @Get('plans') async plans(@CurrentUser() c:any){this.check(c);return db.plan.findMany({orderBy:{priceCents:'asc'}})}
 @Patch('plans/:id') async plan(@CurrentUser() c:any,@Param('id') id:string,@Body() b:any){this.check(c);return db.plan.update({where:{id},data:{...b,maxFileBytes:b.maxFileBytes!==undefined?BigInt(b.maxFileBytes):undefined}})}
 @Get('jobs') async jobs(@CurrentUser() c:any){this.check(c);return db.videoJob.findMany({include:{user:{select:{email:true}}},orderBy:{createdAt:'desc'},take:100})}
}

@Processor('video') class VideoProcessor extends WorkerHost{async process(job:any){const id=job.data.jobId;await db.videoJob.update({where:{id},data:{status:'PROCESSING',progress:5,startedAt:new Date()}});try{ // Replace this adapter with your own FFmpeg/media pipeline.
 await new Promise(r=>setTimeout(r,1000)); const j=await db.videoJob.findUnique({where:{id}});if(!j)throw new Error('Job missing'); const out=`outputs/${j.userId}/${id}-${j.originalName}`; await db.videoJob.update({where:{id},data:{status:'COMPLETED',progress:100,outputKey:out,completedAt:new Date(),durationMs:1000}});return {outputKey:out};
 }catch(e){await db.videoJob.update({where:{id},data:{status:'FAILED',error:String(e)}});throw e;}}}
@Module({imports:[BullModule.forRoot({connection:{url:process.env.REDIS_URL||'redis://localhost:6379'}}),BullModule.registerQueue({name:'video'})],controllers:[AuthController,MeController,PlansController,BillingController,JobsController,AdminController],providers:[AuthGuard,VideoProcessor]}) class AppModule{}
async function bootstrap(){const app=await NestFactory.create(AppModule);app.enableCors({origin:true,credentials:true});app.getHttpAdapter().getInstance().set('json replacer',(_:string,v:any)=>typeof v==='bigint'?v.toString():v);app.setGlobalPrefix('api');await ensureBucket();await app.listen(4000);console.log('API http://localhost:4000');}bootstrap();
