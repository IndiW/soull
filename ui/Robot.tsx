export function Robot({name,size=40}:{name:string;size?:number}){
 const seed=[...name].reduce((n,c)=>n+c.charCodeAt(0),0),hues=[285,155,55],hue=hues[seed%3];
 return <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{color:`oklch(78% .13 ${hue})`}}>
 {seed%3===0?<><path d="M24 10V5" stroke="currentColor" strokeWidth="2"/><circle cx="24" cy="4" r="3" fill="currentColor"/></>:seed%3===1?<path d="M5 20H2v9h3m38-9h3v9h-3" fill="none" stroke="currentColor" strokeWidth="3"/>:<><path d="M7 18 1 13v18l6-4m34-9 6-5v18l-6-4" fill="currentColor"/></>}
 <rect x="7" y="11" width="34" height="29" rx={seed%3===1?10:14} fill="currentColor"/>
 <circle cx="18" cy="25" r="2.7" fill="oklch(24% .025 285)"/><circle cx="30" cy="25" r="2.7" fill="oklch(24% .025 285)"/>
 <path d="M21 32q3 2 6 0" fill="none" stroke="oklch(35% .04 285)" strokeWidth="1.5" strokeLinecap="round"/>
 </svg>;
}
