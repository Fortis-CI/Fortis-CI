## Description
<!-- Describe your changes in detail -->

## Related Issue
<!-- If it fixes an open issue, please link to the issue here (e.g., "Fixes #123") -->

## Type of Change
<!-- Please check the options that apply -->
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Refactoring / Tech Debt

## Checklist:
<!-- As the integration lead, we need to ensure the following are met before merging to `dev` -->
- [ ] My code follows the style guidelines of this project
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas (e.g., complex Cypher queries)
- [ ] My changes generate no new warnings or linting errors
- [ ] I have updated the documentation accordingly (if applicable)
- [ ] I have tested this locally using `docker compose up`

## For the Integration Lead (Reviewer)
- [ ] Database safety check: Cypher queries are indexed and optimized?
- [ ] API contract check: Frontend/Backend integration is solid?
- [ ] No regression on existing graph data model?
