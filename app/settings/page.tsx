"use client";
import Link from 'next/link';
import {Settings,useWorkspace} from '../workspace';

export default function SettingsPage(){
  const w=useWorkspace();
  return <main style={{maxWidth:1100,margin:'0 auto',padding:'32px 24px'}}><Link href="/" className="tool-link">← Back to testing workspace</Link><div style={{marginTop:24}}><Settings w={w}/></div></main>;
}
