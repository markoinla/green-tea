#!/usr/bin/env python3
"""
Apollo.io API Search Tool

Usage:
    python apollo_search.py people --titles "VP Engineering" --industries "Internet" --locations "Singapore"
    python apollo_search.py organizations --name "Zenlayer"
    python apollo_search.py people --filters '{"person_titles":["CEO"],"organization_industry":"Gaming"}'
"""

import os
import sys
import json
import csv
import argparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode

# API key must be set via environment variable
API_KEY = os.environ.get("APOLLO_API_KEY", "")

BASE_URL = "https://api.apollo.io/api/v1"

def make_request(endpoint, payload, api_key=None, use_query_param=False):
    """Make POST request to Apollo API"""
    key = api_key or API_KEY
    url = f"{BASE_URL}/{endpoint}"
    
    if use_query_param:
        url = f"{url}?{urlencode({'api_key': key})}"
        headers = {"Content-Type": "application/json"}
    else:
        headers = {
            "X-Api-Key": key,
            "Content-Type": "application/json"
        }
    
    data = json.dumps(payload).encode("utf-8")
    req = Request(url, data=data, headers=headers, method="POST")
    
    try:
        with urlopen(req) as response:
            # Capture rate limit headers
            rate_limit = response.headers.get("X-RateLimit-Limit")
            rate_remaining = response.headers.get("X-RateLimit-Remaining")
            body = json.loads(response.read().decode("utf-8"))
            body["_rate_limit"] = {"limit": rate_limit, "remaining": rate_remaining}
            return body
    except HTTPError as e:
        error_body = e.read().decode("utf-8")
        try:
            error_json = json.loads(error_body)
            return {"error": error_json, "status": e.code}
        except:
            return {"error": error_body, "status": e.code}

def search_people(filters, page=1, per_page=100, api_key=None):
    """Search for people in Apollo database"""
    endpoint = "mixed_people/api_search"
    payload = {
        **filters,
        "page": page,
        "per_page": per_page
    }
    return make_request(endpoint, payload, api_key)

def search_organizations(filters, page=1, per_page=100, api_key=None):
    """Search for organizations (consumes credits)"""
    endpoint = "mixed_companies/api_search"
    payload = {
        **filters,
        "page": page,
        "per_page": per_page
    }
    return make_request(endpoint, payload, api_key)

def search_team_contacts(filters, api_key=None):
    """Search team contacts (requires master API key)"""
    endpoint = "contacts/api_search"
    payload = filters
    return make_request(endpoint, payload, api_key, use_query_param=True)

def search_team_sequences(filters, api_key=None):
    """Search team sequences (requires master API key)"""
    endpoint = "sequences/api_search"
    payload = filters
    return make_request(endpoint, payload, api_key, use_query_param=True)

def paginate_search(search_func, filters, max_pages=10, api_key=None, **kwargs):
    """Auto-paginate through results"""
    all_results = []
    page = 1
    
    while page <= max_pages:
        response = search_func(filters, page=page, api_key=api_key, **kwargs)
        
        if "error" in response:
            print(f"Error on page {page}: {response.get('error')}", file=sys.stderr)
            break
        
        # Extract results based on endpoint type
        if "people" in response:
            results = response["people"]
            result_key = "people"
        elif "organizations" in response:
            results = response["organizations"]
            result_key = "organizations"
        elif "contacts" in response:
            results = response["contacts"]
            result_key = "contacts"
        elif "sequences" in response:
            results = response["sequences"]
            result_key = "sequences"
        else:
            print(f"No results key found on page {page}", file=sys.stderr)
            break
        
        if not results:
            break
            
        all_results.extend(results)
        print(f"Page {page}: {len(results)} {result_key}", file=sys.stderr)
        
        # Check if we've reached total pages
        pagination = response.get("pagination", {})
        if page >= pagination.get("total_pages", float('inf')):
            break
            
        # Check for partial page
        if len(results) < kwargs.get("per_page", 100):
            break
            
        page += 1
    
    return all_results

def export_to_csv(data, filename, flatten=False):
    """Export results to CSV file"""
    if not data:
        print("No data to export")
        return
    
    # Flatten nested organization data if requested
    if flatten and "organization" in data[0]:
        flat_data = []
        for item in data:
            flat_item = {k: v for k, v in item.items() if k != "organization"}
            if "organization" in item:
                org = item["organization"]
                flat_item.update({
                    "org_name": org.get("name"),
                    "org_domain": org.get("domain"),
                    "org_industry": org.get("industry"),
                    "org_size": org.get("estimated_num_employees")
                })
            flat_data.append(flat_item)
        data = flat_data
    
    keys = data[0].keys()
    with open(filename, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=keys)
        writer.writeheader()
        writer.writerows(data)
    print(f"Exported {len(data)} records to {filename}")

def main():
    parser = argparse.ArgumentParser(description="Apollo.io API Search Tool")
    parser.add_argument("command", choices=["people", "organizations", "contacts", "sequences"],
                      help="Search type")
    parser.add_argument("--api-key", default=API_KEY, help="Apollo API key")
    parser.add_argument("--filters", help="JSON filter string")
    parser.add_argument("--titles", help="Comma-separated job titles (people search)")
    parser.add_argument("--industries", help="Comma-separated industries")
    parser.add_argument("--locations", help="Comma-separated locations")
    parser.add_argument("--name", help="Company name (org search)")
    parser.add_argument("--employee-range", default="100-50000", help="Employee count range")
    parser.add_argument("--keywords", help="Search keywords")
    parser.add_argument("--page", type=int, default=1, help="Page number")
    parser.add_argument("--per-page", type=int, default=100, help="Results per page (max 100)")
    parser.add_argument("--max-pages", type=int, default=1, help="Max pages for pagination")
    parser.add_argument("--export", help="Export to CSV filename")
    parser.add_argument("--export-json", help="Export to JSON filename")
    parser.add_argument("--paginate", action="store_true", help="Auto-paginate through all results")
    parser.add_argument("--flatten", action="store_true", help="Flatten organization data in CSV")
    
    args = parser.parse_args()
    
    # Build filters from arguments
    if args.filters:
        filters = json.loads(args.filters)
    else:
        filters = {}
        if args.titles:
            filters["person_titles"] = [t.strip() for t in args.titles.split(",")]
        if args.industries:
            filters["organization_industry"] = " OR ".join([i.strip() for i in args.industries.split(",")])
        if args.locations:
            filters["organization_locations"] = [l.strip() for l in args.locations.split(",")]
        if args.employee_range:
            filters["organization_num_employees_range"] = args.employee_range
        if args.keywords:
            filters["q_keywords"] = args.keywords
        if args.name:
            filters["q_organization"] = args.name
    
    # Route to appropriate search function
    if args.command == "people":
        if args.paginate:
            results = paginate_search(search_people, filters, 
                                   max_pages=args.max_pages, 
                                   per_page=args.per_page,
                                   api_key=args.api_key)
            response = {"people": results, "_paginated": True, "total": len(results)}
        else:
            response = search_people(filters, args.page, args.per_page, args.api_key)
            results = response.get("people", [])
    elif args.command == "organizations":
        if args.paginate:
            results = paginate_search(search_organizations, filters,
                                   max_pages=args.max_pages,
                                   per_page=args.per_page,
                                   api_key=args.api_key)
            response = {"organizations": results, "_paginated": True, "total": len(results)}
        else:
            response = search_organizations(filters, args.page, args.per_page, args.api_key)
            results = response.get("organizations", [])
    elif args.command == "contacts":
        response = search_team_contacts(filters, args.api_key)
        results = response.get("contacts", [])
    elif args.command == "sequences":
        response = search_team_sequences(filters, args.api_key)
        results = response.get("sequences", [])
    else:
        parser.print_help()
        sys.exit(1)
    
    # Print JSON response
    print(json.dumps(response, indent=2))
    
    # Export if requested
    if args.export and results:
        export_to_csv(results, args.export, flatten=args.flatten)
    
    if args.export_json and results:
        with open(args.export_json, "w", encoding="utf-8") as f:
            if args.command == "people":
                json.dump({"people": results}, f, indent=2)
            elif args.command == "organizations":
                json.dump({"organizations": results}, f, indent=2)
            else:
                json.dump(results, f, indent=2)
        print(f"Exported to {args.export_json}")

if __name__ == "__main__":
    main()