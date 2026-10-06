import { PrismaClient } from '../generated';
import bcrypt from 'bcryptjs';
const db = new PrismaClient();
async function main(){
 const free=await db.plan.upsert({where:{name:'Free'},update:{},create:{name:'Free',priceCents:0,maxFileBytes:100_000_000,dailyJobLimit:3,maxWidth:1920,maxHeight:1080,maxFps:60,priority:20}});
 await db.plan.upsert({where:{name:'Pro'},update:{},create:{name:'Pro',priceCents:999,maxFileBytes:500_000_000,dailyJobLimit:20,maxWidth:3840,maxHeight:2160,maxFps:60,priority:10}});
 await db.plan.upsert({where:{name:'Premium'},update:{},create:{name:'Premium',priceCents:1999,maxFileBytes:2_000_000_000,dailyJobLimit:100,maxWidth:3840,maxHeight:2160,maxFps:120,priority:1}});
 const hash=await bcrypt.hash('Admin123!',12);
 const u=await db.user.upsert({where:{email:'admin@example.com'},update:{role:'ADMIN'},create:{email:'admin@example.com',passwordHash:hash,name:'Admin',role:'ADMIN'}});
 await db.subscription.upsert({where:{userId:u.id},update:{planId:free.id},create:{userId:u.id,planId:free.id}});
 console.log('Admin: admin@example.com / Admin123!');
}
main().finally(()=>db.$disconnect());
