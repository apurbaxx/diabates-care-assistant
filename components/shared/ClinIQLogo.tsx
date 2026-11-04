import type { CSSProperties } from "react";
import styles from "./ClinIQLogo.module.css";

type ClinIQLogoProps = {
  size?: CSSProperties["fontSize"];
  className?: string;
  as?: "span" | "h1";
};

/** Loading-screen wordmark. Keep a light surface behind it on dark layouts. */
export function ClinIQLogo({ size = 30, className, as: Tag = "span" }: ClinIQLogoProps) {
  return (
    <Tag className={[styles.logo, className].filter(Boolean).join(" ")} style={{ fontSize: size }} role="img" aria-label="ClinIQ">
      <span aria-hidden="true">Clin<span className={styles.iq}>IQ</span></span>
    </Tag>
  );
}
