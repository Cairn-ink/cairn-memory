import { DatabaseSync } from 'node:sqlite';
const db=new DatabaseSync(process.argv[2]);
db.exec('PRAGMA busy_timeout=5000; BEGIN');
db.prepare('SELECT store_id FROM store_metadata').get();
const timer=setTimeout(()=>{db.close();process.exit(2);},15000);
process.on('message',message=>{
  if(message!=='release')return;
  clearTimeout(timer);db.exec('COMMIT');db.close();process.disconnect();
});
process.send({ready:true});
