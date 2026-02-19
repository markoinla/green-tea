---
name: apollo-io-search
description: Search Apollo.io database for prospects, organizations, contacts, and sequences using their REST API. Use when user wants to find net new people/companies, enriched contact data, build prospect lists, account research, or sales intelligence tasks.
---

# Apollo.io Search API

Search Apollo.io's database of 210M+ contacts and 35M+ companies for sales prospecting and account research.

## Quick Start: Finding Contacts at a Company

**To find contact information (email/phone) for a specific person:**

1. Use the **People Enrichment** endpoint (`POST /v1/people/match`) with `reveal_personal_emails` and `reveal_phone_number` set to `true`

2. Required fields: `first_name`, `last_name`, and either `organization_name` OR `domain`

3. This consumes API credits based on your Apollo pricing plan

**Example - Get contact info for a specific person:**
```bash
curl -X POST "https://api.apollo.io/v1/people/match" \
  -H "x-api-key: {YOUR_APOLLO_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "John",
    "last_name": "Smith",
    "organization_name": "Acme Corp",
    "reveal_personal_emails": true,
    "reveal_phone_number": true
  }'
```

**To search for people at a specific company by job title:**

1. Use the **People API Search** endpoint (`POST /api/v1/mixed_people/api_search`) - does NOT consume credits
2. Filter by company domain using `q_organization_domains_list: ["company.com"]`
3. Filter by job titles using `person_titles: ["VP Engineering", "CTO"]`
4. Note: This returns basic profile data but NOT email/phone - use People Enrichment to get contact details

**Example - Find VPs at a specific company:**
```bash
curl -X POST "https://api.apollo.io/api/v1/mixed_people/api_search" \
  -H "x-api-key: {YOUR_APOLLO_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "q_organization_domains_list": ["zenlayer.com"],
    "person_titles": ["VP Marketing", "VP Sales"],
    "per_page": 25
  }'
```

## Setup (First Use)

**Before using this skill, you need an Apollo.io API key.**

On first use, ask the user:
> "To use Apollo.io search, I need your API key. You can find it in your Apollo.io account under Settings > API Keys. What is your Apollo.io API key?"

Once the user provides their key:
1. Set the environment variable before running scripts:
   - **macOS/Linux**: `export APOLLO_API_KEY="<user_provided_key>"`
   - **Windows (CMD)**: `set APOLLO_API_KEY=<user_provided_key>`
   - **Windows (PowerShell)**: `$env:APOLLO_API_KEY="<user_provided_key>"`
2. Use the key in all API requests via header: `X-Api-Key: <user_provided_key>`
3. For Team endpoints, use query param: `?api_key=<user_provided_key>`
4. Alternatively, pass the key directly: `python apollo_search.py people --api-key "<user_provided_key>" ...`

**Do not store the API key in any files. Always use the environment variable or pass it directly.**

## Endpoints

### 1. People Enrichment (Get Email/Phone)
**Get detailed contact information including emails and phone numbers for a specific person.**

- **URL**: `POST https://api.apollo.io/v1/people/match`
- **Auth**: Header `x-api-key: {api_key}`
- **Content-Type**: `application/json`
- **Rate Limit**: 600 requests per hour
- **Consumes Credits**: Yes, based on your Apollo pricing plan

**Key Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `first_name` | string | First name of the person (required) |
| `last_name` | string | Last name of the person (required) |
| `name` | string | Full name (alternative to first_name + last_name) |
| `email` | string | Email address if known |
| `hashed_email` | string | MD5 or SHA-256 hashed email |
| `organization_name` | string | Company name (current or previous employer) |
| `domain` | string | Company domain (e.g., "apollo.io") |
| `id` | string | Apollo person ID if known |
| `linkedin_url` | string | LinkedIn profile URL |
| `reveal_personal_emails` | boolean | Set `true` to get email addresses (consumes credits) |
| `reveal_phone_number` | boolean | Set `true` to get phone numbers (consumes credits) |
| `run_waterfall_email` | boolean | Enable waterfall enrichment for broader email coverage |
| `run_waterfall_phone` | boolean | Enable waterfall enrichment for phone numbers |
| `webhook_url` | string | Required if `reveal_phone_number=true` for async delivery |

**Important Notes:**
- Provide as much information as possible for better match accuracy
- Email and phone are NOT returned by default - you must set `reveal_personal_emails: true` and/or `reveal_phone_number: true`
- If you set `reveal_phone_number: true`, you must provide a `webhook_url` for async delivery
- Waterfall enrichment checks third-party data sources for broader coverage
- GDPR regions: Personal emails will not be returned for people in GDPR-compliant regions

**Example curl:**
```bash
curl -X POST "https://api.apollo.io/v1/people/match" \
  -H "x-api-key: {YOUR_APOLLO_API_KEY}" \
  -H "Content-Type: application/json" \
  -H "Cache-Control: no-cache" \
  -d '{
    "first_name": "Tim",
    "last_name": "Zheng",
    "organization_name": "Apollo",
    "reveal_personal_emails": true,
    "reveal_phone_number": true
  }'
```

**Example Response (when reveal flags are true):**
```json
{
  "person": {
    "id": "64a7ff0cc4dfae00013df1a5",
    "first_name": "Tim",
    "last_name": "Zheng",
    "name": "Tim Zheng",
    "linkedin_url": "http://www.linkedin.com/in/tim-zheng-677ba010",
    "title": "Founder & CEO",
    "email": "tim@apollo.io",
    "email_status": "verified",
    "city": "San Francisco",
    "state": "California",
    "country": "United States",
    "contact": {
      "contact_emails": [
        {
          "email": "tim@apollo.io",
          "email_status": "verified",
          "position": 0
        }
      ],
      "phone_numbers": [
        {
          "raw_number": "(123) 456-7890",
          "sanitized_number": "+11234567890",
          "type": "mobile",
          "status": "valid_number"
        }
      ]
    },
    "organization": {
      "id": "5e66b6381e05b4008c8331b8",
      "name": "Apollo.io",
      "website_url": "http://www.apollo.io",
      "primary_domain": "apollo.io",
      "estimated_num_employees": 1600
    }
  }
}
```

### 2. People API Search (Find People, No Contact Info)
Find net new people in Apollo's database — optimized for API usage, **does NOT consume credits**.

**Important:** Does NOT return email addresses or phone numbers. Use People Enrichment to get contact details.

- **URL**: `POST https://api.apollo.io/api/v1/mixed_people/api_search`
- **Auth**: Header `x-api-key: {api_key}` (requires **master API key**)
- **Content-Type**: `application/json`
- **Max**: 50,000 display limit (100 per page × 500 pages)
- **Rate Limit**: 600 requests per hour

**All Parameters** (pass as query params or JSON body):

| Parameter | Type | Description |
|-----------|------|-------------|
| `person_titles[]` | string[] | Job titles to find. Partial matches included (e.g. `"marketing manager"` → `"content marketing manager"`). Only need to match 1. |
| `include_similar_titles` | boolean | Include similar job titles. Set `false` for strict matches only. Default: `true` |
| `q_keywords` | string | Keyword string to filter results |
| `person_locations[]` | string[] | Where people live (city, US state, country). E.g. `["california", "ireland"]` |
| `person_seniorities[]` | string[] | Seniority levels. Options: `owner`, `founder`, `c_suite`, `partner`, `vp`, `head`, `director`, `manager`, `senior`, `entry`, `intern` |
| `organization_locations[]` | string[] | HQ location of employer. E.g. `["singapore", "tokyo"]` |
| `q_organization_domains_list[]` | string[] | **Key filter for finding people at specific companies.** Up to 1,000 domains. E.g. `["zenlayer.com", "apollo.io"]` |
| `organization_ids[]` | string[] | Apollo org IDs. E.g. `["56e44e70f3e5bb2e9400cfc8"]` |
| `organization_num_employees_ranges[]` | string[] | Employee count ranges (comma-separated). E.g. `["1000,5000", "5000,10000"]` |
| `revenue_range[min]` / `revenue_range[max]` | integer | Employer revenue range (no symbols/commas) |
| `contact_email_status[]` | string[] | Email status filter. Options: `verified`, `unverified`, `likely to engage`, `unavailable` |
| `currently_using_any_of_technology_uids[]` | string[] | Employer uses ANY of these techs. E.g. `["salesforce", "google_analytics"]` |
| `currently_using_all_of_technology_uids[]` | string[] | Employer uses ALL of these techs |
| `currently_not_using_any_of_technology_uids[]` | string[] | Exclude by tech usage |
| `q_organization_job_titles[]` | string[] | Active job postings at employer. E.g. `["sales manager"]` |
| `organization_job_locations[]` | string[] | Job posting locations. E.g. `["atlanta", "japan"]` |
| `organization_num_jobs_range[min]` / `[max]` | integer | Active job postings count range |
| `organization_job_posted_at_range[min]` / `[max]` | date | Job posting date range. E.g. `"2025-07-25"` |
| `page` | integer | Page number (default: 1) |
| `per_page` | integer | Results per page (max: 100) |

**Response** returns `total_entries` and `people[]` array with: `id`, `first_name`, `last_name_obfuscated`, `title`, `last_refreshed_at`, `has_email`, `has_city`, `has_state`, `has_country`, `has_direct_phone`, plus nested `organization` object with `name` and availability flags.

**Use Case: Find all VPs at a Specific Company**
```json
{
  "q_organization_domains_list": ["zenlayer.com"],
  "person_titles": ["VP Engineering", "VP Marketing", "VP Sales", "VP Operations"],
  "person_seniorities": ["vp"],
  "per_page": 100
}
```

**Example curl:**
```bash
curl -X POST "https://api.apollo.io/api/v1/mixed_people/api_search" \
  -H "x-api-key: {YOUR_APOLLO_API_KEY}" \
  -H "Content-Type: application/json" \
  -H "Cache-Control: no-cache" \
  -d '{
    "person_titles": ["VP Infrastructure", "CTO"],
    "person_seniorities": ["vp", "c_suite"],
    "organization_locations": ["singapore"],
    "organization_num_employees_ranges": ["250,1000", "1000,5000"],
    "per_page": 25,
    "page": 1
  }'
```

**Error Codes**:
- `401` — Invalid API key
- `403` — Requires master API key (`API_INACCESSIBLE` error)
- `422` — Invalid parameters
- `429` — Rate limit exceeded (max 600/hour)

### 3. Bulk People Enrichment
Enrich data for up to 10 people with a single API call. Useful for batch processing.

- **URL**: `POST https://api.apollo.io/api/v1/people/bulk_enrichment`
- **Auth**: Header `x-api-key: {api_key}`
- **Rate Limit**: 50% of the People Enrichment endpoint's per-minute rate limit
- **Consumes Credits**: Yes

**Parameters:**
- Same as People Enrichment but wrap person details in `details` array
- `api_key`: Your API key
- `details[]`: Array of person objects (max 10)
- `reveal_personal_emails`: boolean
- `reveal_phone_number`: boolean
- `webhook_url`: Required if revealing phone numbers

**Example:**
```bash
curl -X POST "https://api.apollo.io/api/v1/people/bulk_enrichment" \
  -H "x-api-key: {YOUR_APOLLO_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "{YOUR_APOLLO_API_KEY}",
    "details": [
      {
        "first_name": "John",
        "last_name": "Smith",
        "organization_name": "Acme Corp"
      },
      {
        "first_name": "Jane",
        "last_name": "Doe",
        "organization_name": "Tech Inc"
      }
    ],
    "reveal_personal_emails": true,
    "reveal_phone_number": true
  }'
```

### 4. Organization (Company) Search
Find companies in Apollo's database — **consumes credits** per Apollo pricing plan.

- **URL**: `POST https://api.apollo.io/api/v1/mixed_companies/search`
- **Auth**: Header `x-api-key: {api_key}`
- **Content-Type**: `application/json`
- **Max**: 50,000 display limit (100 per page × 500 pages)
- **Rate Limit**: 600 requests per hour

**All Parameters** (pass as query params or JSON body):

| Parameter | Type | Description |
|-----------|------|-------------|
| `q_organization_name` | string | Filter by company name (partial match). E.g. `"apollo"` matches "Apollo Inc" |
| `q_organization_domains_list[]` | string[] | Filter by domain(s). Up to 1,000. E.g. `["zenlayer.com"]` |
| `organization_locations[]` | string[] | HQ location (city, US state, or country). E.g. `["singapore", "japan"]` |
| `organization_not_locations[]` | string[] | Exclude companies by HQ location |
| `organization_num_employees_ranges[]` | string[] | Employee count ranges. E.g. `["250,1000", "5000,10000"]` |
| `revenue_range[min]` / `revenue_range[max]` | integer | Revenue range (no symbols/commas). E.g. `300000` / `50000000` |
| `currently_using_any_of_technology_uids[]` | string[] | Technologies used. Use underscores for spaces. E.g. `["salesforce", "google_analytics"]` |
| `q_organization_keyword_tags[]` | string[] | Keyword tags. E.g. `["mining", "consulting"]` |
| `organization_ids[]` | string[] | Apollo org IDs. E.g. `["5e66b6381e05b4008c8331b8"]` |
| `latest_funding_amount_range[min]` / `[max]` | integer | Latest funding round amount range |
| `total_funding_range[min]` / `[max]` | integer | Total funding across all rounds |
| `latest_funding_date_range[min]` / `[max]` | date | Latest funding date range. E.g. `"2025-07-25"` |
| `q_organization_job_titles[]` | string[] | Active job posting titles. E.g. `["sales manager"]` |
| `organization_job_locations[]` | string[] | Job posting locations. E.g. `["atlanta", "japan"]` |
| `organization_num_jobs_range[min]` / `[max]` | integer | Active job postings count range |
| `organization_job_posted_at_range[min]` / `[max]` | date | Job posting date range |
| `page` | integer | Page number (default: 1) |
| `per_page` | integer | Results per page (max: 100) |

**Response** returns `organizations[]` array with: `id`, `name`, `website_url`, `linkedin_url`, `twitter_url`, `facebook_url`, `phone`, `primary_domain`, `founded_year`, `publicly_traded_symbol`, `publicly_traded_exchange`, `logo_url`, `languages[]`, `alexa_ranking`, `linkedin_uid`, plus `pagination` object.

**Common Filters**:
```json
{
  "q_organization_name": "Zenlayer",
  "organization_locations": ["Singapore", "Hong Kong", "China"],
  "organization_num_employees_ranges": ["1000,10000"]
}
```

**Example curl**:
```bash
curl -X POST "https://api.apollo.io/api/v1/mixed_companies/search" \
  -H "x-api-key: {YOUR_APOLLO_API_KEY}" \
  -H "Content-Type: application/json" \
  -H "Cache-Control: no-cache" \
  -d '{
    "q_organization_keyword_tags": ["cloud infrastructure"],
    "organization_locations": ["singapore"],
    "organization_num_employees_ranges": ["250,1000", "1000,5000"],
    "per_page": 25,
    "page": 1
  }'
```

**Error Codes**:
- `401` — Invalid API key
- `403` — Endpoint requires paid Apollo plan
- `429` — Rate limit exceeded (max 600/hour)

### 5. People Enrichment — Get Email & Phone Numbers
Enrich a person's profile to retrieve verified email addresses and phone numbers. **This endpoint consumes credits** based on your Apollo pricing plan.

- **URL**: `POST https://api.apollo.io/api/v1/people/match`
- **Auth**: Header `x-api-key: {api_key}` (requires **master API key**)
- **Content-Type**: `application/json`
- **Rate Limit**: 600 requests per hour

**Query Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `email` | string | **Option 1**: The person's email address to search by |
| `first_name` + `last_name` | string | **Option 2**: First and last name to search by |
| `name` | string | **Option 2 (alt)**: Full name to search by (use with `domain`) |
| `domain` | string | **Required with name search**: Company's web domain (e.g., `zenlayer.com`) |
| `reveal_personal_emails` | boolean | Set to `true` to retrieve email addresses (uses credits) |
| `reveal_phone_number` | boolean | Set to `true` to retrieve phone numbers (uses credits) |
| `run_waterfall_email` | boolean | Enable waterfall enrichment for emails (tries multiple data sources) |
| `run_waterfall_phone` | boolean | Enable waterfall enrichment for phone numbers |

**Important Notes**:
- The People search endpoint (`mixed_people/api_search`) **does NOT return email/phone** — use THIS endpoint instead
- Email/phone retrieval **consumes credits** based on your Apollo plan
- Waterfall enrichment may consume more credits but has higher success rates
- Use `email` parameter for exact lookup, OR use `name` + `domain` for fuzzy matching

**Example curl — Search by email**:
```bash
curl -X POST "https://api.apollo.io/api/v1/people/match?email=john.doe%40zenlayer.com&reveal_personal_emails=true&reveal_phone_number=true" \
  -H "x-api-key: {YOUR_APOLLO_API_KEY}" \
  -H "Content-Type: application/json" \
  -H "Cache-Control: no-cache"
```

**Example curl — Search by name + domain**:
```bash
curl -X POST "https://api.apollo.io/api/v1/people/match?first_name=John&last_name=Doe&domain=zenlayer.com&reveal_personal_emails=true&reveal_phone_number=true" \
  -H "x-api-key: {YOUR_APOLLO_API_KEY}" \
  -H "Content-Type: application/json" \
  -H "Cache-Control: no-cache"
```

**Response Fields** (email/phone in `person` object):
```json
{
  "person": {
    "id": "5d8f8f8f8f8f8f8f8f8f8f8",
    "first_name": "John",
    "last_name": "Doe",
    "name": "John Doe",
    "email": "john.doe@zenlayer.com",
    "email_status": "verified",
    "phone_numbers": [
      {
        "raw_number": "(555) 123-4567",
        "sanitized_number": "+15551234567",
        "type": "mobile",
        "status": "valid_number"
      }
    ],
    "title": "VP Engineering",
    "linkedin_url": "https://linkedin.com/in/johndoe",
    "organization": {
      "id": "5f5f5f5f5f5f5f5f5f5f5f5f",
      "name": "Zenlayer",
      "domain": "zenlayer.com"
    }
  }
}
```

**Error Codes**:
- `401` — Invalid API key
- `403` — Requires master API key (`API_INACCESSIBLE` error)
- `422` — Invalid parameters
- `429` — Rate limit exceeded

### 6. Bulk People Enrichment — Get Email & Phone for Multiple Contacts
Enrich up to 10 people at once. Same credit rules apply.

- **URL**: `POST https://api.apollo.io/api/v1/people/bulk_match`
- **Auth**: Header `x-api-key: {api_key}` (requires **master API key**)
- **Content-Type**: `application/json`
- **Max**: 10 people per request

**Query Parameters** (same as single enrichment):
- `reveal_personal_emails`: boolean
- `reveal_phone_number`: boolean  
- `run_waterfall_email`: boolean
- `run_waterfall_phone`: boolean

**Request Body**:
```json
{
  "details": [
    { "email": "john@zenlayer.com" },
    { "first_name": "Jane", "last_name": "Smith", "domain": "apolo.io" },
    { "id": "64a7ff0cc4dfae00013df1a5" }
  ]
}
```

**Example curl**:
```bash
curl -X POST "https://api.apollo.io/api/v1/people/bulk_match?reveal_personal_emails=true&reveal_phone_number=true" \
  -H "x-api-key: {YOUR_APOLLO_API_KEY}" \
  -H "Content-Type: application/json" \
  -H "Cache-Control: no-cache" \
  -d '{
    "details": [
      { "email": "john.doe@zenlayer.com" },
      { "first_name": "Jane", "last_name": "Smith", "domain": "apollo.io" }
    ]
  }'
```

**Response**: Returns `matches[]` array with enriched person data, plus `credits_consumed` count.

### 7. Search Team Contacts
Search contacts explicitly added to your team's Apollo account.

- **URL**: `POST https://api.apollo.io/api/v1/contacts/api_search`
- **Auth**: Query param `?api_key={api_key}` (master key required)

### 8. Search Team Sequences
Find sequences created for your team.

- **URL**: `POST https://api.apollo.io/api/v1/sequences/api_search`
- **Auth**: Query param `?api_key={api_key}` (master key required)

## Common Workflows

### Workflow 1: Find Contact Info for a Specific Person

**Step 1**: Use People Enrichment API (this consumes credits):
```bash
# Option A: Search by email
curl -X POST "https://api.apollo.io/api/v1/people/match?email=marko.stankovic%40zenlayer.com&reveal_personal_emails=true&reveal_phone_number=true" \
  -H "x-api-key: {YOUR_APOLLO_API_KEY}" \
  -H "Content-Type: application/json" \
  -H "Cache-Control: no-cache"

# Option B: Search by name + domain
curl -X POST "https://api.apollo.io/api/v1/people/match?first_name=Marko&last_name=Stankovic&domain=zenlayer.com&reveal_personal_emails=true&reveal_phone_number=true" \
  -H "x-api-key: {YOUR_APOLLO_API_KEY}" \
  -H "Content-Type: application/json" \
  -H "Cache-Control: no-cache"
```

**Response includes**: `email`, `email_status`, `phone_numbers[]` array with `sanitized_number`.
```

### Workflow 2: Find All Decision Makers at a Company + Get Their Contact Info
```bash
# Step 1: Search for people by domain (no credits, returns list without email/phone)
curl -X POST "https://api.apollo.io/api/v1/mixed_people/api_search" \
  -H "x-api-key: {YOUR_APOLLO_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "q_organization_domains_list": ["zenlayer.com"],
    "person_titles": ["VP", "Director", "Head", "CTO", "CMO"],
    "person_seniorities": ["vp", "director", "head", "c_suite"],
    "per_page": 100
  }'

# Step 2: For each person found, enrich to get email and phone
# (consumes credits per person enriched)
curl -X POST "https://api.apollo.io/api/v1/people/match?id=APOLLO_PERSON_ID&reveal_personal_emails=true&reveal_phone_number=true" \
  -H "x-api-key: {YOUR_APOLLO_API_KEY}" \
  -H "Content-Type: application/json" \
  -H "Cache-Control: no-cache"
```

**Tip**: Use Bulk People Enrichment for up to 10 people at once to reduce API calls.

### Workflow 3: Find Companies Then Their Executives
```bash
# Step 1: Find target companies
curl -X POST "https://api.apollo.io/api/v1/mixed_companies/search" \
  -H "x-api-key: {YOUR_APOLLO_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "q_organization_keyword_tags": ["cloud infrastructure"],
    "organization_locations": ["singapore"],
    "organization_num_employees_ranges": ["100,1000"]
  }'

# Step 2: Search for executives at each company using domain
```

## Zenlayer-Specific Search Patterns

### Emerging Markets Prospecting
```json
{
  "person_titles": ["VP Infrastructure", "Director Cloud Operations", "Head of Engineering"],
  "person_seniorities": ["vp", "director", "head"],
  "organization_locations": ["Indonesia", "Nigeria", "Brazil", "India", "Vietnam", "Egypt", "South Africa", "Mexico", "Colombia"],
  "q_keywords": "edge computing OR low latency OR GPU infrastructure OR cloud gaming"
}
```

### Global Infrastructure Decision Makers
```json
{
  "person_titles": ["VP Network Operations", "Director Global Infrastructure", "CTO", "Head of Platform Engineering"],
  "person_seniorities": ["vp", "c_suite", "director", "head"],
  "q_keywords": "global infrastructure OR multi-region OR CDN OR edge computing OR cloud gaming OR real-time computing",
  "organization_num_employees_ranges": ["500,50000"]
}
```

### AI/GPU Prospecting
```json
{
  "person_titles": ["VP AI/ML", "Head of AI Infrastructure", "Director GPU Operations"],
  "person_seniorities": ["vp", "director", "head"],
  "q_keywords": "generative AI OR LLM OR GPU cluster OR AI training OR distributed inference",
  "organization_num_employees_ranges": ["1000,50000"]
}
```

## Response Fields

### Person Object (from People Enrichment)
```json
{
  "id": "5d8f8f8f8f8f8f8f8f8f8f8",
  "first_name": "Jane",
  "last_name": "Zhao",
  "name": "Jane Zhao",
  "linkedin_url": "https://www.linkedin.com/in/jane-zhao-1234",
  "title": "VP of Cloud Infrastructure",
  "seniority": "vp",
  "email": "jane@example.com",
  "email_status": "verified",
  "city": "San Francisco",
  "state": "California",
  "country": "United States",
  "contact": {
    "contact_emails": [
      {
        "email": "jane@example.com",
        "email_status": "verified"
      }
    ],
    "phone_numbers": [
      {
        "raw_number": "(415) 123-4567",
        "sanitized_number": "+14151234567",
        "type": "mobile",
        "status": "valid_number"
      }
    ]
  },
  "organization": {
    "id": "5f5f5f5f5f5f5f5f5f5f5f5f",
    "name": "Global Gaming Corp",
    "domain": "globalgaming.com",
    "industry": "Gaming",
    "estimated_num_employees": 3500
  }
}
```

### Organization Object
```json
{
  "id": "5f5f5f5f5f5f5f5f5f5f5f5f",
  "name": "Zenlayer Inc",
  "domain": "zenlayer.com",
  "linkedin_url": "https://www.linkedin.com/company/zenlayer",
  "industry": "Telecommunications",
  "estimated_num_employees": 550
}
```

## Pagination

All searches support pagination:
- `page`: Current page number (default: 1)
- `per_page`: Results per page (max: 100)

**Example**:
```bash
curl -X POST "https://api.apollo.io/api/v1/mixed_people/api_search" \
  -H "x-api-key: {YOUR_APOLLO_API_KEY}" \
  -H "Content-Type: application/json" \
  -H "Cache-Control: no-cache" \
  -d '{"person_titles":["VP Engineering"],"page":2,"per_page":100}'
```

## Rate Limits

Check headers returned:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining in current window

Rate limits vary by Apollo plan (per minute/hour/day thresholds apply).

**Endpoint-Specific Limits:**
- People API Search: 600/hour
- People Enrichment: 600/hour
- Bulk People Enrichment: 50% of People Enrichment rate
- Organization Search: 600/hour

## Quick Script

See `scripts/apollo_search.py` for Python search function with:
- Automatic pagination
- JSON/CSV export
- Error handling
- Rate limit tracking

## Troubleshooting

**Error 403 (error code: 1010)**: 
- The Organization Search endpoint **consumes credits** — verify your Apollo plan has credits
- Team Contacts/Sequences require **master API key** (query param auth, not header)
- Some endpoints may require paid plan or different authentication

**No email/phone in response:**
- Make sure you've set `reveal_personal_emails: true` and/or `reveal_phone_number: true`
- Check if the person is in a GDPR region (personal emails won't be returned)
- Verify you have sufficient API credits

**Webhook not receiving phone numbers:**
- Ensure your webhook URL is publicly accessible over HTTPS
- Check that you've included `webhook_url` parameter when `reveal_phone_number: true`

See `references/troubleshooting.md` for complete error codes and solutions.

## References

- Full API documentation: `references/people-api-search.md`
- Organization search reference: `references/organization-api-search.md`
- People Enrichment reference: `references/people-enrichment.md`
- Troubleshooting guide: `references/troubleshooting.md`
