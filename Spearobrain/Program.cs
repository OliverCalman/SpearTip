using SpearTips;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllersWithViews();
builder.Services.AddHttpClient("MarineApi", client =>
{
    client.DefaultRequestHeaders.Add("User-Agent", "SpearTips/1.0 (marine research app)");
    client.Timeout = TimeSpan.FromSeconds(15);
});
builder.Services.AddResponseCaching();
builder.Services.Configure<ApiSettings>(builder.Configuration.GetSection("ApiSettings"));

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseRouting();
app.UseResponseCaching();
app.MapStaticAssets();
app.MapControllerRoute(
    name:    "default",
    pattern: "{controller=Home}/{action=Index}/{id?}")
    .WithStaticAssets();

app.Run();
