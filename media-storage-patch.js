"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");

const assetRoot = path.resolve(process.env.MEDIA_ASSET_STORAGE_DIR || path.join(process.env.STORAGE_DIR || "/data", "assets"));
const allowed = new Set([
  "frames","stickers","filters","filter-thumbnails","fonts","layout-thumbnails",
  "news-frames","news-filters","ui-skins","gallery","sessions-v4","misc"
]);
fs.mkdirSync(assetRoot,{recursive:true});

function safe(v,fallback="ALL"){
  const out=String(v||fallback).trim().replace(/[^A-Za-z0-9_.-]+/g,"_").slice(0,120);
  return out||fallback;
}
function publicBase(req){
  const explicit=String(process.env.PUBLIC_BASE_URL||"").replace(/\/+$/,"");
  if(explicit)return explicit;
  const proto=String(req.get("x-forwarded-proto")||req.protocol||"https").split(",")[0].trim();
  return `${proto}://${req.get("host")}`;
}
function authorize(req,res,next){
  const expected=String(process.env.MEDIA_SERVICE_TOKEN||"").trim();
  if(!expected)return res.status(503).json({success:false,error:"MEDIA_SERVICE_TOKEN chưa được cấu hình"});
  const actual=String(req.get("x-media-token")||req.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  const a=Buffer.from(actual),b=Buffer.from(expected);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({success:false,error:"Media token không hợp lệ"});
  next();
}
function resolveCategory(req,res,next){
  const category=safe(req.params.category,"");
  if(!allowed.has(category))return res.status(400).json({success:false,error:"Nhóm media không hợp lệ"});
  req.mediaCategory=category;
  req.mediaOrganization=safe(req.query.organizationId||req.get("x-organization-id"),"ALL");
  req.mediaStore=safe(req.query.storeId||req.get("x-store-id"),"ALL");
  next();
}
const storage=multer.diskStorage({
  destination(req,file,cb){
    try{
      const dir=path.join(assetRoot,req.mediaCategory,req.mediaOrganization,req.mediaStore);
      fs.mkdirSync(dir,{recursive:true});cb(null,dir);
    }catch(e){cb(e);}
  },
  filename(req,file,cb){
    const ext=path.extname(file.originalname||"").toLowerCase().replace(/[^.a-z0-9]/g,"").slice(0,10);
    const base=safe(path.basename(file.originalname||"asset",path.extname(file.originalname||"")),"asset").slice(0,60);
    cb(null,`${Date.now()}_${crypto.randomBytes(5).toString("hex")}_${base}${ext}`);
  }
});
const upload=multer({storage,limits:{fileSize:Math.max(20,Number(process.env.MAX_UPLOAD_MB||220))*1024*1024}});

const originalListen=express.application.listen;
express.application.listen=function patchedListen(...args){
  if(!this.__pgMediaStorageInstalled){
    this.__pgMediaStorageInstalled=true;
    this.use("/assets",express.static(assetRoot,{fallthrough:true,etag:true,maxAge:"1h"}));

    this.post("/api/storage/:category",authorize,resolveCategory,upload.single("file"),(req,res)=>{
      if(!req.file)return res.status(400).json({success:false,error:"Không có file"});
      const rel=path.relative(assetRoot,req.file.path).split(path.sep).join("/");
      res.json({
        success:true,
        category:req.mediaCategory,
        organizationId:req.mediaOrganization,
        storeId:req.mediaStore,
        fileName:req.file.filename,
        relativePath:rel,
        url:`${publicBase(req)}/assets/${rel.split("/").map(encodeURIComponent).join("/")}`,
        size:req.file.size,
        mimeType:req.file.mimetype||"application/octet-stream"
      });
    });

    this.delete("/api/storage",authorize,(req,res)=>{
      const rel=String(req.query.path||"").replace(/^\/+/,"");
      const target=path.resolve(assetRoot,rel);
      if(!rel||!(target===assetRoot||target.startsWith(assetRoot+path.sep)))return res.status(400).json({success:false,error:"Đường dẫn không hợp lệ"});
      if(fs.existsSync(target)&&fs.statSync(target).isFile())fs.unlinkSync(target);
      res.json({success:true});
    });

    this.get("/api/storage-health",authorize,(req,res)=>res.json({success:true,assetRoot,categories:[...allowed]}));
    console.log(`[MEDIA STORAGE] mounted at ${assetRoot}`);
  }
  return originalListen.apply(this,args);
};
