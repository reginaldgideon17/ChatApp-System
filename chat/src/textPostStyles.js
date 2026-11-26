export const TEXT_POST_STYLES = [
  { id: "sunset", label: "Sunset", background: "linear-gradient(135deg, #ff7a59, #d94683)" },
  { id: "ocean", label: "Ocean", background: "linear-gradient(135deg, #22a8c7, #3156c8)" },
  { id: "berry", label: "Berry", background: "linear-gradient(135deg, #8b5cf6, #d94683)" },
  { id: "mint", label: "Mint", background: "linear-gradient(135deg, #13a98b, #176b70)" },
  { id: "solar", label: "Solar", background: "linear-gradient(135deg, #f3a712, #e45b36)" },
  { id: "midnight", label: "Midnight", background: "linear-gradient(135deg, #475569, #171b35)" },
];

export function getTextPostStyle(id) {
  return TEXT_POST_STYLES.find((style) => style.id === id) || TEXT_POST_STYLES[0];
}
