const {PDFDocument,StandardFonts,rgb}=require("pdf-lib");
function toRgb(a){return Array.isArray(a)&&a.length===3?rgb(a[0],a[1],a[2]):rgb(0,0,0);}
function mapFont(n){const m={
"Times-Roman":StandardFonts.TimesRoman,"Times-Bold":StandardFonts.TimesBold,
"Times-Italic":StandardFonts.TimesItalic,"Times-BoldItalic":StandardFonts.TimesBoldItalic,
"Helvetica":StandardFonts.Helvetica,"Helvetica-Bold":StandardFonts.HelveticaBold,
"Helvetica-Oblique":StandardFonts.HelveticaOblique,"Helvetica-BoldOblique":StandardFonts.HelveticaBoldOblique,
"Courier":StandardFonts.Courier,"Courier-Bold":StandardFonts.CourierBold,
"Courier-Oblique":StandardFonts.CourierOblique,"Courier-BoldOblique":StandardFonts.CourierBoldOblique};
return m[n]||StandardFonts.TimesRoman;}
function wrap(t,f,s,w,tr=0){const a=String(t||"").split(/(\s+)/);const o=[];let l="";
for(const x of a){const T=l+x;const W=f.widthOfTextAtSize(T,s)+(T.length-1)*tr;
if(W<=w||!l.length)l=T;else{o.push(l.trimEnd());l=x.trimStart();}}
if(l.length)o.push(l.trimEnd());return o;}

module.exports=async(req,res)=>{
 try{
  if(req.method!=="POST")return res.status(405).json({error:"Use POST"});
  const b=await new Promise((r,j)=>{let d="";req.on("data",c=>d+=c);
    req.on("end",()=>r(JSON.parse(d)));req.on("error",j);});
  const {file_b64,blocks}=b;
  const pdf=await PDFDocument.load(Buffer.from(file_b64,"base64"),{updateMetadata:false});
  const need=new Set();for(const x of blocks||[])if(x.type!=="line")need.add(x.font_mapped||"Times-Roman");
  const emb={};for(const n of need)emb[n]=await pdf.embedFont(mapFont(n));
  if(!emb["Times-Roman"])emb["Times-Roman"]=await pdf.embedFont(StandardFonts.TimesRoman);
  for(const x of blocks||[]){const p=pdf.getPage(Math.max(0,(x.page||1)-1)),H=p.getHeight();
    if(x.type==="line"){p.drawRectangle({x:x.x,y:H-x.y-x.thick,width:x.width,height:x.thick,color:toRgb(x.color)});continue;}
    const f=emb[x.font_mapped]||emb["Times-Roman"];const size=x.size||11,w=x.width||460;
    const lh=x.line_height||size*1.35,tr=x.tracking||0,c=toRgb(x.color||[0,0,0]);
    let y=x.y;for(const para of String(x.text||"").split(/\r?\n/)){
      for(const line of wrap(para,f,size,w,tr)){
        p.drawText(line,{x:x.x,y:H-y-size,font:f,size,color:c,maxWidth:w});
        y+=lh;
      }y+=lh*0.15;
    }
  }
  const out=await pdf.save({useObjectStreams:false});
  res.json({file_b64:Buffer.from(out).toString("base64")});
 }catch(e){res.status(500).json({error:String(e.message||e)});}
};
