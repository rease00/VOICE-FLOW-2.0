import fs from 'fs';
const dir = 'frontend/.next/server/chunks';
const file = fs.readdirSync(dir).find(f => f.includes('root-of-the-server'));
const text = fs.readFileSync(`${dir}/${file}`, 'utf8');
console.log(text.slice(0, 1000));
