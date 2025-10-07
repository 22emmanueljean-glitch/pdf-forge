import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "./index.css";

pdfjs.GlobalWorkerOptions.workerSrc =
  `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.js`;

export default function App(){
  const [file,setFile]=useState(null);
  const [pdfData,setPdfData]=useState(null);
  const [edits,setEdits]=useState([]);
  const [coords,setCoords]=useState({x:72,y:720,page:1});
  const [text,setText]=useState("");

  const send=async()=>{
    const buf=await file.arrayBuffer();
    const b64=btoa(String.fromCharCode(...new Uint8Array(buf)));
    const res=await fetch("/api/edit",{method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({file:b64,edits:[{page:coords.page,x:coords.x,y:coords.y,text}]})
    });
    const {pdf}=await res.json();
    const blob=new Blob([Uint8Array.from(atob(pdf),c=>c.charCodeAt(0))],{type:"application/pdf"});
    const url=URL.createObjectURL(blob);
    setPdfData(url);
  };

  return (
  <div className="app">
    <h2>PDF Forge</h2>
    <input type="file" onChange={e=>setFile(e.target.files[0])}/>
    <textarea value={text} onChange={e=>setText(e.target.value)}
      placeholder="Enter text to insert..."/>
    <button onClick={send}>Apply Edit</button>
    {pdfData &&
      <Document file={pdfData}>
        <Page pageNumber={1}/>
      </Document>}
  </div>);
}
