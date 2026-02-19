# Apollo.io Organization API Search Reference

https://docs.apollo.io/reference/organization-search

## Overview

The Organization API finds companies in Apollo's database. **Consumes credits** as part of your Apollo pricing plan.

## Endpoint

```
POST https://api.apollo.io/api/v1/mixed_companies/api_search
```

## Authentication

```
X-Api-Key: {your_api_key}
```

## Request Body Parameters

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `q_organization` | string | Company name search | `"Zenlayer"` |
| `organization_industry` | string | Industry category | `"Telecommunications"` |
| `organization_locations` | array[string] | Company location | `["Singapore", "China"]` |
| `organization_num_employees_range` | string | Employee count range | `"500-5000"` |
| `technologies` | array[string] | Technologies used | `["AWS", "Kubernetes", "VMware"]` |
| `revenue_range` | string | Revenue range filter | `"$10M-$50M"` |
| `is_publicly_traded` | boolean | Public company filter | `false` |
| `page` | integer | Page number | `1` |
| `per_page` | integer | Results per page (max: 100) | `100` |

## Common Industry Values

- Telecommunications
- Internet
- Computer Software
- Financial Services
- Gaming
- Information Technology Services
- Computer Hardware
- Cloud Services
- Content Delivery Network (CDN)

## Response Fields

```json
{
  "organizations": [
    {
      "id": "5f5f8f8f8f8f8f8f8f8f8f8f",
      "name": "Zenlayer Inc",
      "domain": "zenlayer.com",
      "linkedin_url": "https://www.linkedin.com/company/zenlayer",
      "website_url": "https://www.zenlayer.com",
      "industry": "Telecommunications",
      "estimated_num_employees": 550,
      "publicly_traded": false,
      "revenue_range": "$100M-$250M",
      "technologies": ["AWS", "Kubernetes", "Bare Metal", "Global Edge Network"],
      "locations": [
        {
          "country": "Singapore",
          "city": "Singapore",
          "address": "10 Anson Road"
        },
        {
          "country": "China",
          "city": "Shanghai",
          "address": "123 Century Avenue"
        }
      ],
      "founded_year": 2014
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 100,
    "total_entries": 1,
    "total_pages": 1
  }
}
```

## Company Search Patterns for Zenlayer

### Edge Computing / CDN Companies
```json
{
  "q_keywords": "edge computing OR CDN OR content delivery",
  "organization_locations": ["Singapore", "Hong Kong", "United States"],
  "organization_num_employees_range": "100-5000",
  "technologies": ["CloudFlare", "Fastly", "Akamai"]
}
```

### Gaming Infrastructure Companies
```json
{
  "organization_industry": "Gaming",
  "q_keywords": "cloud gaming OR game infrastructure OR multiplayer gaming",
  "organization_locations": ["United States", "China", "South Korea"],
  "organization_num_employees_range": "500-50000"
}
```

### Emerging Market Cloud Providers
```json
{
  "q_organization": "",
  "organization_locations": ["Brazil", "Nigeria", "Indonesia", "India"],
  "q_keywords": "cloud provider OR edge computing OR local cloud",
  "organization_num_employees_range": "100-10000"
}
```

## Example Request

```bash
curl -X POST "https://api.apollo.io/api/v1/mixed_companies/api_search" \
  -H "X-Api-Key: {YOUR_APOLLO_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "q_organization": "Zenlayer",
    "page": 1,
    "per_page": 10
  }'
```

## Error Codes

| Status | Code | Meaning |
|--------|------|---------|
| 200 | OK | Success |
| 401 | unauthorized | Invalid API key |
| 403 | forbidden | Plan does not support Organization search |
| 422 | unprocessable_entity | Invalid parameters |
| 429 | rate_limit_exceeded | Credit or rate limit exceeded |
| 500 | internal_server_error | Server error |