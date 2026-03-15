export interface TagRelationshipItem {
  id: number;
  antecedent_name: string;
  consequent_name: string;
  status?: string;
  created_at?: string;
}

export interface TagRelationships {
  aliases: TagRelationshipItem[];
  implications: TagRelationshipItem[];
}

export function resolveCanonicalTag(tag: string, relationships: TagRelationships | null): string {
  const alias = relationships?.aliases.find((item) => item.antecedent_name === tag && item.status !== 'deleted');
  return alias?.consequent_name || tag;
}

export function getDirectImplicationTags(tag: string, relationships: TagRelationships | null): string[] {
  return (relationships?.implications || [])
    .filter((item) => item.antecedent_name === tag && item.status !== 'deleted')
    .map((item) => item.consequent_name)
    .filter((value, index, array) => array.indexOf(value) === index)
    .sort();
}
