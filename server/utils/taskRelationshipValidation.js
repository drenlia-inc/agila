/**
 * Classify cross-type relationship conflict for a task pair.
 *
 * @param {Array<{ relationship?: string }>} existingRows
 * @param {'parent' | 'child' | 'related' | string} requestedRelationship
 * @returns {'PARENT_CHILD_EXISTS' | 'RELATED_EXISTS' | 'RELATIONSHIP_ALREADY_EXISTS'}
 */
export function classifyRelationshipConflict(existingRows, requestedRelationship) {
  const hasHierarchy = existingRows.some(
    (row) => row.relationship === 'parent' || row.relationship === 'child'
  );
  const hasRelated = existingRows.some((row) => row.relationship === 'related');
  const wantsHierarchy = requestedRelationship === 'parent' || requestedRelationship === 'child';
  const wantsRelated = requestedRelationship === 'related';

  if (hasHierarchy && wantsRelated) {
    return 'PARENT_CHILD_EXISTS';
  }
  if (hasRelated && wantsHierarchy) {
    return 'RELATED_EXISTS';
  }
  if (hasRelated && wantsRelated) {
    return 'RELATED_EXISTS';
  }
  if (hasHierarchy && wantsHierarchy) {
    return 'PARENT_CHILD_EXISTS';
  }
  return 'RELATIONSHIP_ALREADY_EXISTS';
}

/**
 * @param {import('i18next').TFunction} tTranslator
 * @param {'PARENT_CHILD_EXISTS' | 'RELATED_EXISTS' | 'RELATIONSHIP_ALREADY_EXISTS' | string} code
 */
export function relationshipConflictMessage(tTranslator, code) {
  if (code === 'PARENT_CHILD_EXISTS') {
    return tTranslator('errors.parentChildRelationshipAlreadyExists');
  }
  if (code === 'RELATED_EXISTS') {
    return tTranslator('errors.relatedTaskAlreadySet');
  }
  return tTranslator('errors.relationshipAlreadyExists');
}

/**
 * @param {import('i18next').TFunction} tTranslator
 * @param {'PARENT_CHILD_EXISTS' | 'RELATED_EXISTS' | 'RELATIONSHIP_ALREADY_EXISTS' | string} code
 */
export function relationshipConflictResponse(tTranslator, code) {
  const normalizedCode =
    code === 'PARENT_CHILD_EXISTS' || code === 'RELATED_EXISTS'
      ? code
      : 'RELATIONSHIP_ALREADY_EXISTS';
  return {
    status: 409,
    body: {
      code: normalizedCode,
      error: relationshipConflictMessage(tTranslator, normalizedCode),
    },
  };
}
