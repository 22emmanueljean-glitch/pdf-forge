const pdfjsLib = require("pdfjs-dist");
pdfjsLib.GlobalWorkerOptions.workerSrc = require("pdfjs-dist/build/pdf.worker.js");

function rectsIntersect(a,b){return !(a.x+a.w<b.x||a.x>b.x+b.w||a.y+a.h<b.y||a.y>b.y+b.h);}
function fontGuess(n=""){n=String(n);const helv=/helv/i.test(n),cour=/cour/i.test(n);
const times=/times|newroman|tnr|minion|garamond|serif/i.test(n)||(!helv&&!cour);
return times?"Times-Roman":helv?"Helvetica":"Courier";}

module.exports=async(req,res)=>{
 try{
  if(req.method!=="POST")return res.status(405).json({error:"Use POST"});
  const body=await new Promise((r,j)=>{let d="";req.on("data",c=>d+=c);
    req.on("end",()=>r(JSON.parse(d)));req.on("error",j);});
  const {file_b64,page,rect}=body;
  if(!file_b64||!page||!rect)return res.status(400).json({error:"Missing fields"});
  const data=Buffer.from(file_b64,"base64");
  const doc=await pdfjsLib.getDocument({data}).promise;
  const p=Math.min(Math.max(1,page),doc.numPages);
  const pg=await doc.getPage(p);
  const vp=pg.getViewport({scale:1});const H=vp.height;
  const txt=await pg.getTextContent();const spans=[];
  for(const it of txt.items){
    const [a,b,c,d,e,f]=it.transform;const s=Math.max(Math.abs(a),Math.abs(d));
    const x=e,yTop=H-f-s,w=it.width,h=s*1.2;
    if(rectsIntersect({x,y:yTop,w,h},rect))
      spans.push({text:it.str,x,y:yTop,w,h,size:s,
        font_name:it.fontName||"",font_mapped:fontGuess(it.fontName||"")});
  }
  res.json({page_width:vp.width,page_height:vp.height,spans});
 }catch(e){res.status(500).json({error:String(e.message||e)});}
};
