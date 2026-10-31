"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import styles from "./StartupScreen.module.css";

export function StartupScreen({
children,
}: {
children: React.ReactNode;
}) {
const pathname = usePathname();
const [loading, setLoading] = useState(true);

useEffect(() => {
if (pathname === "/knowledge-assistant") {
setLoading(true);
}


const timer = window.setTimeout(() => {
  setLoading(false);
}, 3000);

return () => window.clearTimeout(timer);


}, [pathname]);

useEffect(() => {
if (!loading) return;


const previousOverflow = document.body.style.overflow;
document.body.style.overflow = "hidden";
return () => {
  document.body.style.overflow = previousOverflow;
};


}, [loading]);

return (
<>
{loading && ( <div className={styles.screen}>
{/* Full-screen video background */} <div className={styles.introVideo} aria-hidden="true"> <video
           src="/cliniq-intro.mp4"
           autoPlay
           muted
           playsInline
           loop
           preload="auto"
         /> </div>


      {/* Loading message above the video */}
      <main
        className={styles.loader}
        role="status"
        aria-live="polite"
        aria-label="Loading CliniQ records"
      >
        <div className={styles.text}>
          <p className={styles.cap}>
            Loading records<i>.</i><i>.</i><i>.</i>
          </p>
        </div>
      </main>
    </div>
  )}

  {/* Application content */}
  <div hidden={loading}>{children}</div>
</>


);
}
