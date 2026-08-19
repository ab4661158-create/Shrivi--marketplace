/* SHRIVI CUSTOMER BACKEND CONTRACT
   Loaded by the feature proxy. Provides visible customer controls and calls the
   real PostgreSQL-backed API when the corresponding endpoints are available.
*/
(function(){
  'use strict';
  const api=window.ShriviCustomerAPI={
    async request(url,options={}){
      const r=await fetch(url,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
      const data=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(data.error||'Request failed');
      return data;
    },
    me(){return this.request('/api/customer/me')},
    orders(){return this.request('/api/customer/orders')},
    addresses(){return this.request('/api/customer/addresses')},
    addAddress(data){return this.request('/api/customer/addresses',{method:'POST',body:JSON.stringify(data)})},
    reviews(productId){return this.request('/api/products/'+encodeURIComponent(productId)+'/reviews')},
    addReview(productId,data){return this.request('/api/products/'+encodeURIComponent(productId)+'/reviews',{method:'POST',body:JSON.stringify(data)})},
    returns(orderId,data){return this.request('/api/customer/orders/'+encodeURIComponent(orderId)+'/return',{method:'POST',body:JSON.stringify(data)})},
    notifications(){return this.request('/api/customer/notifications')}
  };
})();
