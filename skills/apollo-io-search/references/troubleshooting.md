# Apollo.io API Troubleshooting

## Common Error Codes

| Error | Code | Meaning | Solution |
|-------|------|---------|----------|
| `1010` | 403 | Forbidden/Permission denied | Check if endpoint requires master API key vs standard key; Organization search consumes credits — ensure plan has credits |
| `401` | 401 | Unauthorized | Invalid API key or key not activated |
| `422` | 422 | Unprocessable Entity | Invalid search parameters — check filter syntax |
| `429` | 429 | Rate Limited | Too many requests — check `X-RateLimit-Remaining` header |
| `500` | 500 | Server Error | Retry with exponential backoff |

## Authentication Methods

### Standard API Key (People/Organization Search)
```
Header: X-Api-Key: {your_key}
```

### Master API Key (Team Contacts/Sequences)
```
Query Param: ?api_key={your_key}
```

**Important**: Your API key may work differently for:
- **People Search** → Header auth, no credit consumption
- **Organization Search** → Header auth, **consumes credits**
- **Team Contacts/Sequences** → Query param auth, requires master key

## Endpoint Correctness

Verified endpoints from Apollo.io documentation:
- `POST https://api.apollo.io/api/v1/mixed_people/api_search` → People (consumes NO credits)
- `POST https://api.apollo.io/api/v1/mixed_companies/api_search` → Organizations (**consumes credits**)
- `POST https://api.apollo.io/api/v1/contacts/api_search` → Team contacts (master key)
- `POST https://api.apollo.io/api/v1/sequences/api_search` → Team sequences (master key)

## Plan Requirements

| Endpoint | Credit Usage | Plan Level |
|----------|-------------|------------|
| People Search | ❌ NO | All plans |
| Organization Search | ✅ YES | Paid plans only |
| Team Contacts | N/A | Master key required |
| Team Sequences | N/A | Master key required |

## Headers to Monitor

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 850
X-RateLimit-Reset: 1699123456
```

## Testing Checklist

✅ API key is active in Apollo.io settings  
✅ For Organization search: plan has credits available  
✅ For Team endpoints: using master key with query param auth  
✅ JSON filters are properly escaped  
✅ Employee ranges use correct format: `"100-5000"` or `"1000-10000"`  

## Support Resources

- Apollo.io API Documentation: https://docs.apollo.io/docs/api-overview
- Rate limit questions: Check `X-RateLimit-*` headers in response
- Credit consumption: Organization search credits show in Apollo billing dashboard