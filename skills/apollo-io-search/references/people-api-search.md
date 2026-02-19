# Apollo.io People API Search Reference

https://docs.apollo.io/reference/people-api-search

## Overview

The People API (Mixed People) finds net new people in Apollo's database.

### Key Characteristics
- **Does NOT consume credits** — API-optimized search
- **Display limit**: 50,000 records (100 per page × 500 pages)
- **Does NOT return**: Email addresses or phone numbers
- **Requires**: Standard API key (header authentication)

## Endpoint

```
POST https://api.apollo.io/api/v1/mixed_people/api_search
```

## Authentication

```
X-Api-Key: {your_api_key}
```

## Request Body Parameters

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `person_titles` | array[string] | Job titles to match | `["VP Engineering", "CEO"]` |
| `person_seniorities` | array[string] | Seniority levels | `["vp", "c_suite", "director"]` |
| `person_locations` | array[string] | Person located in | `["San Francisco", "Singapore"]` |
| `organization_ids` | array[string] | Specific company IDs | `["5f5f8f8f8f8f8f8f8f8f8f8"]` |
| `q_keywords` | string | General search terms | `"edge computing OR cloud infrastructure"` |
| `organization_industry` | string | Company industry category | `"Telecommunications"` |
| `organization_locations` | array[string] | Company's location | `["Singapore", "China"]` |
| `organization_num_employees_range` | string | Company size range | `"1000-10000"` |
| `reveal_on_limit` | boolean | Auto-enrich at display limit | `true` |
| `page` | integer | Page number (default: 1) | `1` |
| `per_page` | integer | Results per page (max: 100) | `100` |

## Seniority Values

| Value | Description |
|-------|-------------|
| `c_suite` | C-level executives |
| `vp` | Vice Presidents |
| `director` | Directors |
| `manager` | Managers |
| `individual_contributor` | IC-level |

## Response Fields

```json
{
  "people": [
    {
      "id": "5d8f4f8f8f8f8f8f8f8f8f8f",
      "first_name": "Jane",
      "last_name": "Zhao",
      "name": "Jane Zhao",
      "linkedin_url": "https://www.linkedin.com/in/jane-zhao-123456",
      "title": "VP of Cloud Infrastructure",
      "seniority": "vp",
      "departments": ["engineering", "operations"],
      "organization": {
        "id": "5f5f5f5f5f5f5f5f5f5f5f5f",
        "name": "Global Gaming Corp",
        "domain": "globalgaming.com",
        "linkedin_url": "https://www.linkedin.com/company/global-gaming-corp",
        "website_url": "https://www.globalgaming.com",
        "industry": "Gaming",
        "estimated_num_employees": 3500,
        "publicly_traded": false,
        "revenue_range": "$50M-$100M"
      },
      "departments": ["engineering", "operations"],
      "subdepartments": ["cloud infrastructure", "platform engineering"]
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 100,
    "total_entries": 2500,
    "total_pages": 25
  }
}
```

## Error Codes

| Status | Code | Meaning |
|--------|------|---------|
| 200 | OK | Success |
| 401 | unauthorized | Invalid API key |
| 422 | unprocessable_entity | Invalid search parameters |
| 429 | rate_limit_exceeded | Too many requests |
| 500 | internal_server_error | Server error |

## Rate Limit Headers

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 850
```

## Example: Complete Search Request

```bash
curl -X POST "https://api.apollo.io/api/v1/mixed_people/api_search" \
  -H "X-Api-Key: {YOUR_APOLLO_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "person_titles": ["VP Infrastructure", "Director Cloud Operations", "CTO"],
    "person_seniorities": ["vp", "director", "c_suite"],
    "organization_industry": "Internet OR Telecommunications OR Gaming",
    "organization_locations": ["Singapore", "Hong Kong", "Indonesia", "Nigeria"],
    "organization_num_employees_range": "1000-10000",
    "reveal_on_limit": true,
    "page": 1,
    "per_page": 100
  }'
```