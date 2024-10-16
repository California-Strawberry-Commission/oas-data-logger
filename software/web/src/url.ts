let baseURL = 'http://localhost:8080/api/'
if (process.env.NODE_ENV === 'production') {
  baseURL = 'https://api.example.com/'
}

const isProd = process.env.NODE_ENV === 'production'


export function url(target: string): string {
  if (isProd)
    return target;
  else
    return "/api" + target;
}