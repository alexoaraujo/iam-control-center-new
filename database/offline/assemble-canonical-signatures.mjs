#!/usr/bin/env node
// Offline assembly only. Never reads private keys, signs, connects or authorizes.
import { constants, openSync, closeSync, fstatSync, readSync, writeFileSync,
  realpathSync, statSync, lstatSync } from "node:fs";
import { resolve, relative, dirname, isAbsolute, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256 } from "../../scripts/check-migration-lineage.mjs";
import { prepareBaseline } from "./prepare-canonical-baseline.mjs";
const ROOT=resolve(import.meta.dirname,"../..");
const HEX=/^[a-f0-9]{64}$/;
const LIMIT=8*1024*1024;
function check(ok, code){if(!ok) throw Error(code);}
export function assembleDetached({packetBytes,evidenceBytes,trustBytes,collectorSignature,reviewerSignature,
    expectedPacketSha256,expectedTrustSha256,root,now=Date.now()}){
  for(const b of [packetBytes,evidenceBytes,trustBytes])
    check(Buffer.isBuffer(b)&&b.length>0&&b.length<=LIMIT,"INVALID_CUSTODY_INPUT");
  check(typeof expectedPacketSha256==="string"&&HEX.test(expectedPacketSha256)&&
    sha256(packetBytes)===expectedPacketSha256,"PACKET_PIN_MISMATCH");
  check(typeof expectedTrustSha256==="string"&&HEX.test(expectedTrustSha256)&&
    sha256(trustBytes)===expectedTrustSha256,"TRUST_PIN_MISMATCH");
  check(Buffer.isBuffer(collectorSignature)&&collectorSignature.length===64&&
    Buffer.isBuffer(reviewerSignature)&&reviewerSignature.length===64,"INVALID_DETACHED_SIGNATURE");
  const trust=JSON.parse(trustBytes.toString("utf8"));
  const signatures={collector:collectorSignature.toString("base64"),reviewer:reviewerSignature.toString("base64")};
  const report=prepareBaseline({packetBytes,evidenceBytes,signatures,trust,root,now});
  check(report.verdict==="BLOCKED"&&Object.values(report.controls).every(x=>x===false),
    "UNEXPECTED_AUTHORIZATION");
  return {signatures,receipt:{format:"iam-offline-signature-assembly/v1",
    packet_sha256:expectedPacketSha256,trust_sha256:expectedTrustSha256,
    evidence_sha256:sha256(evidenceBytes),source_sha:report.source_sha,
    collector_fingerprint_sha256:trust.collector.fingerprint_sha256,
    reviewer_fingerprint_sha256:trust.reviewer.fingerprint_sha256,
    signature_status:"VERIFIED_AGAINST_SUPPLIED_PINS_ONLY",
    trust_roots_independently_approved:false,baseline_approved:false,execution_authorized:false}};
}
function outsideRepo(path){
  const rel=relative(realpathSync(ROOT),path);
  check(rel===".."||rel.startsWith(".."+sep)||isAbsolute(rel),"PRIVATE_PATH_INSIDE_REPO");
}
function privateDir(path){
  const real=realpathSync(path),st=statSync(real);
  outsideRepo(real);
  check(st.isDirectory()&&(st.mode&0o077)===0&&st.uid===process.getuid(),"PRIVATE_DIRECTORY_REQUIRED");
  return real;
}
function privateRead(path,limit){
  const absolute=resolve(path),parent=privateDir(dirname(absolute));
  check(realpathSync(dirname(absolute))===parent&&!lstatSync(absolute).isSymbolicLink(),"SYMLINK_REJECTED");
  const fd=openSync(absolute,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const st=fstatSync(fd);
    check(st.isFile()&&st.uid===process.getuid()&&(st.mode&0o077)===0&&st.nlink===1&&
      st.size>0&&st.size<=limit,"PRIVATE_FILE_REQUIRED");
    const bytes=Buffer.alloc(st.size);
    // Read through a bounded descriptor, never from an untrusted stream.
    let offset=0;
    while(offset<bytes.length){
      const chunk=readSync(fd,bytes,offset,bytes.length-offset,null);
      check(chunk>0,"PRIVATE_FILE_CHANGED"); offset+=chunk;
    }
    const extra=Buffer.alloc(1);
    check(readSync(fd,extra,0,1,null)===0&&fstatSync(fd).size===st.size,"PRIVATE_FILE_CHANGED");
    return bytes;
  }finally{closeSync(fd);}
}
function main(){
  check(!process.env.CI&&!process.env.GITHUB_ACTIONS&&process.stdin.isTTY&&process.stdout.isTTY,
    "PRIVATE_INTERACTIVE_SESSION_REQUIRED");
  check(typeof process.getuid==="function"&&process.argv.length===10,"INVALID_USAGE");
  const [packet,evidence,trust,c,r,packetPin,trustPin,out]=process.argv.slice(2);
  const result=assembleDetached({packetBytes:privateRead(packet,LIMIT),evidenceBytes:privateRead(evidence,LIMIT),
    trustBytes:privateRead(trust,16384),collectorSignature:privateRead(c,64),reviewerSignature:privateRead(r,64),
    expectedPacketSha256:packetPin,expectedTrustSha256:trustPin,root:ROOT});
  const path=resolve(out);privateDir(dirname(path));
  // No overwrite. Only the signatures required by prepareBaseline, not evidence or keys.
  const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,JSON.stringify(result.signatures,null,2)+"\n");}finally{closeSync(fd);}
  process.stdout.write("PASS_OFFLINE_SIGNATURE_ASSEMBLY_REVIEW_ONLY\n");
  process.stdout.write("packet_sha256="+result.receipt.packet_sha256+"\n");
  process.stdout.write("trust_sha256="+result.receipt.trust_sha256+"\n");
  process.stdout.write("BASELINE_AND_EXECUTION_BLOCKED\n");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  process.umask(0o077);
  try{main();}catch{process.stderr.write("BLOCKED_OFFLINE_SIGNATURE_ASSEMBLY\n");process.exitCode=2;}
}
